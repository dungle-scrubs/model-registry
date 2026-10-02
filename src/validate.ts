import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../registry.schema.json" with { type: "json" };
import { collectRatingMismatchProblems } from "./calibration.js";
import { buildRouteLabel } from "./label.js";
import { EFFORT_LADDER } from "./ladder.js";
import {
  CURRENT_FORMAT,
  canMigrateFrom,
  MIGRATE_STEPS,
  type MigrateStepEntry,
} from "./migrate-steps.js";
import type {
  Calibration,
  IndexedRoute,
  JsonValue,
  Meter,
  Model,
  RegistryErrorCode,
  RegistryFacts,
  RegistryProblem,
  Route,
  RouteLabel,
} from "./types.js";
import { DECLARATION_SECTIONS, ROUTE_RATING_NAME } from "./types.js";

export interface RegistryIndex {
  registry: RegistryFacts;
  routes: Record<RouteLabel, IndexedRoute>;
  sections: Record<string, JsonValue>;
}

export type ValidationResult =
  | { index: RegistryIndex; ok: true }
  | { ok: false; problems: readonly [RegistryProblem, ...RegistryProblem[]] };

const EFFORT_LADDER_VALUES = EFFORT_LADDER.join(", ");

export const AJV_OPTIONS = { allErrors: true, strictNumbers: true } as const;

// allErrors collects every fault in one pass; strictNumbers rejects
// non-finite numbers, such as the Infinity JSON.parse builds from 1e400.
let shapeValidator: ValidateFunction | undefined;

function getShapeValidator(): ValidateFunction {
  if (shapeValidator === undefined) {
    shapeValidator = new Ajv2020(AJV_OPTIONS).compile(schema);
  }
  return shapeValidator;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Define a property without routing a key such as `__proto__` through the prototype setter. */
export function safeSet<TValue>(target: object, key: string, value: TValue): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function childPath(parent: string, ...parts: Array<string | number>): string {
  let path = parent;
  for (const part of parts) {
    path += typeof part === "number" ? `[${part}]` : `[${JSON.stringify(part)}]`;
  }
  return path;
}

function olderFormatFix(format: number, steps: readonly MigrateStepEntry[]): string {
  if (canMigrateFrom(format, steps)) {
    return `Run model-registry migrate to upgrade the file from format ${format} to format ${CURRENT_FORMAT}.`;
  }
  return `Recreate the file as a format ${CURRENT_FORMAT} registry; no migration step from format ${format} ships in this release.`;
}

function invalidProblem(field: string, message: string, fix: string): RegistryProblem {
  return { code: "registry-invalid", field, fix, message };
}

const REFERENCE_TARGETS = {
  capability: { owner: "route", section: "capabilities" },
  meter: { owner: "route", section: "meters" },
  rating: { owner: "model", section: "ratings" },
  benchmark: { owner: "calibration feeds", section: "benchmarks (under calibration)" },
  model: { owner: "calibration overrides", section: "models" },
  route: { owner: "calibration overrides", section: "routes (built from models)" },
} as const;

type ReferenceKind = keyof typeof REFERENCE_TARGETS;

interface ReferenceProblemInput {
  field: string;
  kind: ReferenceKind;
  name: string;
}

function referenceUnknownProblem(input: ReferenceProblemInput): RegistryProblem {
  const target = REFERENCE_TARGETS[input.kind];
  return {
    code: "reference-unknown",
    field: input.field,
    fix: `Add "${input.name}" to the ${target.section} section, or remove the ${input.kind} from the ${target.owner}.`,
    message: `the ${input.kind} "${input.name}" is not declared in the ${target.section} section`,
  };
}

export function aggregateCode(problems: readonly RegistryProblem[]): RegistryErrorCode {
  const first = problems[0]?.code;
  if (first === undefined) {
    return "registry-invalid";
  }
  return problems.every((problem) => problem.code === first) ? first : "registry-invalid";
}

/** Decode an Ajv instancePath, a JSON pointer, into its property segments. */
function pointerSegments(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((raw) => raw.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function walkSegments(
  root: unknown,
  segments: readonly string[],
): { path: string; value: unknown } {
  let path = "$";
  let value: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(value)) {
      path += `[${segment}]`;
      value = value[Number(segment)];
    } else {
      path += `[${JSON.stringify(segment)}]`;
      value = isPlainObject(value) && Object.hasOwn(value, segment) ? value[segment] : undefined;
    }
  }
  return { path, value };
}

function isDeclarationSection(name: string): boolean {
  return (DECLARATION_SECTIONS as readonly string[]).includes(name);
}

function pointerIsOwned(pointer: string): boolean {
  const [head] = pointerSegments(pointer);
  return (
    head === undefined || head === "models" || head === "calibration" || isDeclarationSection(head)
  );
}

function genericProblem(field: string, message: string | undefined): RegistryProblem {
  return invalidProblem(
    field,
    message ?? "the registry does not match the published schema",
    "Fix the registry so it matches registry.schema.json, the published format 1 schema.",
  );
}

function unknownFieldProblem(
  path: string,
  name: string,
  owner: "calibration" | "model" | "route" | "meter" | "benchmark" | "band" | "figure" | "override",
): RegistryProblem {
  return invalidProblem(
    childPath(path, name),
    `the field "${name}" is not part of a format 1 ${owner}`,
    "Remove the field, or move free text into notes.",
  );
}

function requiredStringProblem(parent: string, name: string): RegistryProblem {
  return invalidProblem(
    childPath(parent, name),
    `the required field "${name}" is missing`,
    `Add a "${name}" string.`,
  );
}

/** The format 1 construct an owned instance path points at, by section name and depth. */
type OwnedPath =
  | { kind: "calibration"; section: "root" }
  | { kind: "calibrationBenchmark"; benchmark: string }
  | { kind: "calibrationBenchmarkField"; benchmark: string; field: string }
  | { kind: "calibrationBand"; benchmark: string; index: number }
  | { kind: "calibrationBandField"; benchmark: string; index: number; field: string }
  | { kind: "calibrationFeeds"; rating: string }
  | { kind: "calibrationFeedsEntry"; rating: string; index: number }
  | { kind: "calibrationFigureSubject"; benchmark: string }
  | { kind: "calibrationFigureBenchmark"; subject: string; benchmark: string }
  | { kind: "calibrationHandSetEntry"; index: number }
  | { kind: "calibrationOverridesEntry"; index: number }
  | { kind: "calibrationOverridesEntryField"; index: number; field: string }
  | { kind: "declaration"; name: string; section: "capabilities" | "ratings" }
  | { kind: "model"; modelKey: string }
  | { field: string; kind: "modelField"; modelKey: string }
  | { kind: "modelRating"; modelKey: string; rating: string }
  | { kind: "meter"; meterName: string }
  | { field: string; kind: "meterField"; meterName: string }
  | { kind: "other" }
  | { kind: "root" }
  | { kind: "route" }
  | { field: string; kind: "routeField" }
  | { kind: "routeCapabilityEntry" }
  | { kind: "section"; section: "calibration" | "capabilities" | "meters" | "models" | "ratings" };

function classifyPath(segments: readonly string[]): OwnedPath {
  const [section_, head, container, index, field, leaf] = segments;
  const inModelsRoutes = section_ === "models" && container === "routes" && index !== undefined;
  switch (segments.length) {
    case 0:
      return { kind: "root" };
    case 1:
      switch (section_) {
        case "calibration":
          return { kind: "calibration", section: "root" };
        case "capabilities":
        case "meters":
        case "models":
        case "ratings":
          return { kind: "section", section: section_ };
        default:
          return { kind: "other" };
      }
    case 2:
      switch (section_) {
        case "models":
          return { kind: "model", modelKey: head ?? "" };
        case "meters":
          return { kind: "meter", meterName: head ?? "" };
        case "capabilities":
        case "ratings":
          return { kind: "declaration", name: head ?? "", section: section_ };
        default:
          return { kind: "other" };
      }
    case 3:
      if (section_ === "meters") {
        return { field: container ?? "", kind: "meterField", meterName: head ?? "" };
      }
      if (section_ === "models") {
        return { field: container ?? "", kind: "modelField", modelKey: head ?? "" };
      }
      if (section_ === "calibration") {
        if (head === "benchmarks" && container !== undefined) {
          return { kind: "calibrationBenchmark", benchmark: container };
        }
        if (head === "feeds" && container !== undefined) {
          return { kind: "calibrationFeeds", rating: container };
        }
        if (head === "figures" && container !== undefined) {
          return { kind: "calibrationFigureSubject", benchmark: container };
        }
        if (head === "handSet" && container !== undefined) {
          return { kind: "calibrationHandSetEntry", index: Number(container) };
        }
        if (head === "overrides" && container !== undefined) {
          return { kind: "calibrationOverridesEntry", index: Number(container) };
        }
      }
      return { kind: "other" };
    case 4:
      if (section_ === "models" && container === "ratings") {
        return { kind: "modelRating", modelKey: head ?? "", rating: index ?? "" };
      }
      if (section_ === "models" && container === "routes") {
        return { kind: "route" };
      }
      if (section_ === "calibration") {
        if (head === "benchmarks" && container !== undefined && index !== undefined) {
          return {
            kind: "calibrationBenchmarkField",
            benchmark: container,
            field: index,
          };
        }
        if (head === "feeds" && container !== undefined && index !== undefined) {
          return { kind: "calibrationFeedsEntry", rating: container, index: Number(index) };
        }
        if (head === "figures" && container !== undefined && index !== undefined) {
          return {
            kind: "calibrationFigureBenchmark",
            subject: container,
            benchmark: index,
          };
        }
        if (head === "overrides" && container !== undefined && index !== undefined) {
          return {
            kind: "calibrationOverridesEntryField",
            index: Number(container),
            field: index,
          };
        }
      }
      return { kind: "other" };
    case 5:
      if (inModelsRoutes) {
        return { field: field ?? "", kind: "routeField" };
      }
      if (
        section_ === "calibration" &&
        head === "benchmarks" &&
        container !== undefined &&
        index === "bands" &&
        field !== undefined
      ) {
        return { kind: "calibrationBand", benchmark: container, index: Number(field) };
      }
      return { kind: "other" };
    case 6:
      if (inModelsRoutes && field === "capabilities") {
        return { kind: "routeCapabilityEntry" };
      }
      if (
        section_ === "calibration" &&
        head === "benchmarks" &&
        container !== undefined &&
        index === "bands" &&
        field !== undefined &&
        leaf !== undefined
      ) {
        return {
          kind: "calibrationBandField",
          benchmark: container,
          index: Number(field),
          field: leaf,
        };
      }
      return { kind: "other" };
    default:
      return { kind: "other" };
  }
}

function ratingValueProblem(path: string, modelKey: string, rating: string): RegistryProblem {
  return invalidProblem(
    path,
    `the rating "${rating}" of model "${modelKey}" must be an integer from 1 to 10`,
    `Set the rating "${rating}" of model "${modelKey}" to an integer from 1 to 10.`,
  );
}

function ownedProblem(root: unknown, error: ErrorObject): RegistryProblem {
  const segments = pointerSegments(error.instancePath);
  const path = walkSegments(root, segments).path;
  const location = classifyPath(segments);

  switch (error.keyword) {
    case "required":
      return requiredProblem(location, path, error);
    case "additionalProperties":
      return additionalPropertyProblem(location, path, error);
    case "enum":
      return enumProblem(location, path, error);
    case "const":
      return constProblem(location, path, error);
    case "type":
    case "minimum":
    case "maximum":
    case "minLength":
      return typeProblem(location, path) ?? genericProblem(path, error.message);
    default:
      return genericProblem(path, error.message);
  }
}

function requiredProblem(location: OwnedPath, path: string, error: ErrorObject): RegistryProblem {
  const missing = error.params.missingProperty;
  if (typeof missing !== "string") {
    return genericProblem(path, error.message);
  }
  switch (location.kind) {
    case "root":
      if (missing === "models") {
        return invalidProblem(
          childPath(path, "models"),
          'the required field "models" is missing',
          "Add a models object with one entry per model.",
        );
      }
      break;
    case "model":
      if (missing === "family") {
        return requiredStringProblem(path, "family");
      }
      if (missing === "routes") {
        return invalidProblem(
          childPath(path, "routes"),
          `the model "${location.modelKey}" is missing the required field "routes"`,
          "Add a routes array to the model; an empty array is valid.",
        );
      }
      break;
    case "route":
      if (missing === "harness") {
        return requiredStringProblem(path, "harness");
      }
      if (missing === "modelId") {
        return requiredStringProblem(path, "modelId");
      }
      if (missing === "hosted") {
        return invalidProblem(
          childPath(path, "hosted"),
          'the required field "hosted" is missing',
          'Add a "hosted" boolean; a wrong guess either way is a privacy fault.',
        );
      }
      break;
    case "calibrationBenchmark":
      return benchmarkRequiredProblem(path, missing);
    case "calibrationBand":
      return bandRequiredProblem(path, missing);
    case "calibrationFigureBenchmark":
      return figureRequiredProblem(path, missing);
    case "calibrationOverridesEntry":
      return overrideRequiredProblem(path, missing);
  }
  return genericProblem(path, error.message);
}

function benchmarkRequiredProblem(path: string, missing: string): RegistryProblem {
  const fieldFixes: Record<string, string> = {
    source: 'Add a "source" string naming the upstream.',
    field: 'Add a "field" string naming the benchmark column.',
    version: 'Add a "version" string for the table version.',
    direction: 'Add a "direction" of "higher" or "lower".',
    bands: "Add a bands array with at least one band.",
  };
  return invalidProblem(
    childPath(path, missing),
    `the benchmark is missing the required field "${missing}"`,
    fieldFixes[missing] ?? `Add a "${missing}" entry.`,
  );
}

function bandRequiredProblem(path: string, missing: string): RegistryProblem {
  return invalidProblem(
    childPath(path, missing),
    `the band is missing the required field "${missing}"`,
    missing === "at"
      ? 'Add an "at" number for the figure value at this band.'
      : 'Add a "score" integer from 1 to 10.',
  );
}

function figureRequiredProblem(path: string, missing: string): RegistryProblem {
  const fixes: Record<string, string> = {
    value: 'Add a "value" number for the figure.',
    read: 'Add a "read" string naming the date read.',
    effort: 'Add an "effort" ladder level for the figure.',
  };
  return invalidProblem(
    childPath(path, missing),
    `the figure is missing the required field "${missing}"`,
    fixes[missing] ?? `Add a "${missing}" entry.`,
  );
}

function overrideRequiredProblem(path: string, missing: string): RegistryProblem {
  const fixes: Record<string, string> = {
    rating: 'Add a "rating" string naming the rating to override.',
    model: 'Add a "model" key for the model whose rating is being overridden.',
    route: 'Add a "route" label for the route whose cost is being overridden.',
    value: 'Add a "value" integer from 1 to 10.',
    reason: 'Add a non-empty "reason" string.',
  };
  return invalidProblem(
    childPath(path, missing),
    `the override is missing the required field "${missing}"`,
    fixes[missing] ?? `Add a "${missing}" entry.`,
  );
}

function additionalPropertyProblem(
  location: OwnedPath,
  path: string,
  error: ErrorObject,
): RegistryProblem {
  const name = error.params.additionalProperty;
  if (typeof name !== "string") {
    return genericProblem(path, error.message);
  }
  switch (location.kind) {
    case "meter":
      return unknownFieldProblem(path, name, "meter");
    case "model":
      return unknownFieldProblem(path, name, "model");
    case "route":
      return unknownFieldProblem(path, name, "route");
    case "calibration":
      return unknownFieldProblem(path, name, "calibration");
    case "calibrationBenchmark":
      return unknownFieldProblem(path, name, "benchmark");
    case "calibrationBand":
      return unknownFieldProblem(path, name, "band");
    case "calibrationFigureBenchmark":
      return unknownFieldProblem(path, name, "figure");
    case "calibrationOverridesEntry":
      return unknownFieldProblem(path, name, "override");
  }
  return genericProblem(path, error.message);
}

function enumProblem(location: OwnedPath, path: string, error: ErrorObject): RegistryProblem {
  if (
    location.kind === "modelField" &&
    (location.field === "maxEffort" || location.field === "fixedEffort")
  ) {
    return invalidProblem(
      path,
      `the field "${location.field}" must be one of ${EFFORT_LADDER_VALUES}`,
      `Set "${location.field}" to one of ${EFFORT_LADDER_VALUES}.`,
    );
  }
  if (location.kind === "calibrationBenchmarkField" && location.field === "direction") {
    return invalidProblem(
      path,
      `the benchmark direction must be "higher" or "lower"`,
      `Set "direction" to "higher" or "lower".`,
    );
  }
  return genericProblem(path, error.message);
}

function constProblem(location: OwnedPath, path: string, error: ErrorObject): RegistryProblem {
  if (location.kind === "meterField" && location.field === "spendToZero") {
    return invalidProblem(
      path,
      `the meter "${location.meterName}" field "spendToZero" accepts only the literal true`,
      'Set "spendToZero" to true, or remove it.',
    );
  }
  return genericProblem(path, error.message);
}

function typeProblem(location: OwnedPath, path: string): RegistryProblem | undefined {
  switch (location.kind) {
    case "section":
      switch (location.section) {
        case "models":
          return invalidProblem(
            path,
            'the field "models" must be a JSON object keyed by model key',
            "Replace models with a JSON object keyed by model key.",
          );
        case "ratings":
          return invalidProblem(
            path,
            'the field "ratings" must be a JSON object keyed by rating name',
            "Replace ratings with a JSON object keyed by rating name.",
          );
        case "capabilities":
          return invalidProblem(
            path,
            'the field "capabilities" must be a JSON object keyed by capability name',
            "Replace capabilities with a JSON object keyed by capability name.",
          );
        case "meters":
          return invalidProblem(
            path,
            'the field "meters" must be a JSON object keyed by meter name',
            "Replace meters with a JSON object keyed by meter name.",
          );
        case "calibration":
          return invalidProblem(
            path,
            'the field "calibration" must be a JSON object',
            "Replace calibration with a JSON object.",
          );
      }
      return undefined;
    case "declaration":
      if (location.section === "ratings") {
        return invalidProblem(
          path,
          `the rating "${location.name}" must be described by a string`,
          `Describe the rating "${location.name}" with a one-line string.`,
        );
      }
      return invalidProblem(
        path,
        `the capability "${location.name}" must be described by a string`,
        `Describe the capability "${location.name}" with a one-sentence string.`,
      );
    case "meter":
      return invalidProblem(
        path,
        `the meter "${location.meterName}" must be a JSON object`,
        "Replace the meter value with a JSON object.",
      );
    case "model":
      return invalidProblem(
        path,
        `the model "${location.modelKey}" must be a JSON object`,
        "Replace the model with a JSON object.",
      );
    case "meterField":
      if (location.field === "notes") {
        return invalidProblem(
          path,
          `the meter "${location.meterName}" field "notes" must be a string`,
          `Set the meter "${location.meterName}" notes to a string, or remove it.`,
        );
      }
      return undefined;
    case "modelField":
      switch (location.field) {
        case "family":
          return invalidProblem(
            path,
            'the field "family" must be a string',
            'Set "family" to a string.',
          );
        case "notes":
          return invalidProblem(
            path,
            'the field "notes" must be a string',
            'Set "notes" to a string, or remove it.',
          );
        case "routes":
          return invalidProblem(
            path,
            "the routes field must be an array",
            "Set routes to an array of route objects.",
          );
        case "ratings":
          return invalidProblem(
            path,
            `the model "${location.modelKey}" ratings field must be a JSON object`,
            `Set the model "${location.modelKey}" ratings to a JSON object of integer ratings.`,
          );
      }
      return undefined;
    case "modelRating":
      return ratingValueProblem(path, location.modelKey, location.rating);
    case "route":
      return invalidProblem(
        path,
        "the route must be a JSON object",
        "Replace the route with a JSON object.",
      );
    case "routeField":
      switch (location.field) {
        case "harness":
        case "modelId":
          return invalidProblem(
            path,
            `the field "${location.field}" must be a string`,
            `Set "${location.field}" to a string.`,
          );
        case "provider":
        case "notes":
          return invalidProblem(
            path,
            `the field "${location.field}" must be a string`,
            `Set "${location.field}" to a string, or remove it.`,
          );
        case "hosted":
          return invalidProblem(
            path,
            'the field "hosted" must be a boolean',
            'Set "hosted" to true or false.',
          );
        case "privacyEligible":
          return invalidProblem(
            path,
            'the field "privacyEligible" must be a boolean',
            'Set "privacyEligible" to true or false, or remove it.',
          );
        case "cost":
          return invalidProblem(
            path,
            'the field "cost" must be an integer from 1 to 10',
            'Set "cost" to an integer from 1 (expensive) to 10 (cheap).',
          );
        case "rateLimitRpm":
        case "responseSeconds":
          return invalidProblem(
            path,
            `the field "${location.field}" must be a number of 0 or more`,
            `Set "${location.field}" to a finite number of 0 or more.`,
          );
        case "meter":
          return invalidProblem(
            path,
            'the field "meter" must be a string naming a declared meter',
            'Set "meter" to a meter name declared in the meters section, or remove it.',
          );
        case "capabilities":
          return invalidProblem(
            path,
            'the field "capabilities" must be an array of strings',
            'Set "capabilities" to an array of capability names declared in the capabilities section, or remove it.',
          );
      }
      return undefined;
    case "routeCapabilityEntry":
      return invalidProblem(
        path,
        "a route capability entry must be a string",
        "Set the entry to a capability name declared in the capabilities section, or remove the entry.",
      );
    case "calibration":
      return invalidProblem(
        path,
        "the calibration section must be a JSON object",
        "Replace calibration with a JSON object.",
      );
    case "calibrationBenchmark":
      return invalidProblem(
        path,
        `the benchmark "${location.benchmark}" must be a JSON object`,
        "Replace the benchmark with a JSON object.",
      );
    case "calibrationBenchmarkField":
      switch (location.field) {
        case "source":
        case "field":
        case "version":
          return invalidProblem(
            path,
            `the benchmark field "${location.field}" must be a string`,
            `Set "${location.field}" to a string.`,
          );
        case "direction":
          return invalidProblem(
            path,
            'the benchmark field "direction" must be "higher" or "lower"',
            'Set "direction" to "higher" or "lower".',
          );
        case "bands":
          return invalidProblem(
            path,
            "the benchmark bands field must be a non-empty array",
            "Set bands to a non-empty array of {at, score} objects.",
          );
        case "notes":
          return invalidProblem(
            path,
            'the benchmark field "notes" must be a string',
            'Set "notes" to a string, or remove it.',
          );
      }
      return undefined;
    case "calibrationBand":
      return invalidProblem(
        path,
        "a band must be a JSON object",
        "Replace the band with a JSON object.",
      );
    case "calibrationBandField":
      if (location.field === "at") {
        return invalidProblem(
          path,
          'the band field "at" must be a number',
          'Set "at" to a finite number.',
        );
      }
      if (location.field === "score") {
        return invalidProblem(
          path,
          'the band field "score" must be an integer from 1 to 10',
          'Set "score" to an integer from 1 to 10.',
        );
      }
      return undefined;
    case "calibrationFeeds":
      return invalidProblem(
        path,
        `the calibration feeds entry for "${location.rating}" must be a non-empty array of benchmark names`,
        "Set the feeds entry to a non-empty array of benchmark names declared in calibration.benchmarks.",
      );
    case "calibrationFeedsEntry":
      return invalidProblem(
        path,
        "a feeds benchmark entry must be a string",
        "Set the entry to a benchmark name declared in calibration.benchmarks.",
      );
    case "calibrationFigureSubject":
      return invalidProblem(
        path,
        `the figures entry for "${location.benchmark}" must be a JSON object`,
        "Replace the figures entry with a JSON object keyed by benchmark name.",
      );
    case "calibrationFigureBenchmark":
      return invalidProblem(
        path,
        `the figure for "${location.benchmark}" on "${location.subject}" must be a JSON object`,
        "Replace the figure with a JSON object with value, read and effort.",
      );
    case "calibrationHandSetEntry":
      return invalidProblem(
        path,
        "a handSet entry must be a string",
        "Set the entry to a rating name.",
      );
    case "calibrationOverridesEntry":
      return invalidProblem(
        path,
        "an override entry must be a JSON object",
        "Replace the override with a JSON object.",
      );
    case "calibrationOverridesEntryField":
      switch (location.field) {
        case "rating":
        case "model":
        case "route":
          return invalidProblem(
            path,
            `the override field "${location.field}" must be a string`,
            `Set "${location.field}" to a string.`,
          );
        case "value":
          return invalidProblem(
            path,
            'the override field "value" must be an integer from 1 to 10',
            'Set "value" to an integer from 1 to 10.',
          );
        case "reason":
          return invalidProblem(
            path,
            'the override field "reason" must be a non-empty string',
            'Set "reason" to a non-empty string.',
          );
      }
      return undefined;
    default:
      return undefined;
  }
}

function curateProblems(root: unknown, errors: readonly ErrorObject[]): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const seen = new Set<string>();
  const push = (problem: RegistryProblem) => {
    const key = JSON.stringify([problem.code, problem.field]);
    if (!seen.has(key)) {
      seen.add(key);
      problems.push(problem);
    }
  };

  const foreignPointers = new Set<string>();
  for (const error of errors) {
    if (error.keyword === "anyOf" && !pointerIsOwned(error.instancePath)) {
      foreignPointers.add(error.instancePath);
    }
  }
  const deepestPointers = new Set(foreignPointers);
  for (const pointer of foreignPointers) {
    for (
      let ancestor = pointer.slice(0, pointer.lastIndexOf("/"));
      ancestor !== "";
      ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"))
    ) {
      deepestPointers.delete(ancestor);
    }
  }
  for (const error of errors) {
    if (
      error.keyword !== "anyOf" ||
      pointerIsOwned(error.instancePath) ||
      !deepestPointers.has(error.instancePath)
    ) {
      continue;
    }
    const { path, value } = walkSegments(root, pointerSegments(error.instancePath));
    if (value === null) {
      push(
        invalidProblem(
          path,
          "null is not a valid value anywhere in a registry file",
          "Replace the null with the field's value, or remove the field.",
        ),
      );
    } else if (typeof value === "number") {
      push(
        invalidProblem(
          path,
          "numbers in a registry file must be finite",
          "Rewrite the number so it stays within double-precision range, for example 1e308 rather than 1e400.",
        ),
      );
    } else {
      push(genericProblem(path, error.message));
    }
  }

  for (const error of errors) {
    if (error.keyword === "anyOf" || !pointerIsOwned(error.instancePath)) {
      continue;
    }
    push(ownedProblem(root, error));
  }

  if (problems.length === 0 && errors.length > 0) {
    push(genericProblem("$", errors[0]?.message));
  }
  return problems;
}

interface RouteVisit {
  modelKey: string;
  route: Record<string, unknown>;
  routePath: string;
}

/** Walk every route the models section can yield, skipping anything unreadable; a shape problem already names it. */
function forEachRoute(
  root: Record<string, unknown>,
  visit: (routeVisit: RouteVisit) => void,
): void {
  const models = root.models;
  if (!isPlainObject(models)) {
    return;
  }
  for (const [modelKey, modelValue] of Object.entries(models)) {
    if (!isPlainObject(modelValue) || !Array.isArray(modelValue.routes)) {
      continue;
    }
    const modelPath = childPath("$", "models", modelKey);
    modelValue.routes.forEach((routeValue, index) => {
      if (isPlainObject(routeValue)) {
        visit({
          modelKey,
          route: routeValue,
          routePath: childPath(modelPath, "routes", index),
        });
      }
    });
  }
}

/**
 * Report duplicate labels wherever the label components are readable, even
 * when another fact on the same route is invalid. This is a semantic check;
 * the schema cannot express it.
 */
function collectLabelProblems(root: Record<string, unknown>, problems: RegistryProblem[]): void {
  const labelOwners = new Map<RouteLabel, string>();
  forEachRoute(root, ({ modelKey, route, routePath }) => {
    const providerValid = !Object.hasOwn(route, "provider") || typeof route.provider === "string";
    if (typeof route.harness !== "string" || !providerValid) {
      return;
    }
    const label = buildRouteLabel(modelKey, route as Pick<Route, "harness" | "provider">);
    const owner = labelOwners.get(label);
    if (owner === undefined) {
      labelOwners.set(label, routePath);
    } else {
      problems.push({
        code: "label-duplicate",
        field: routePath,
        fix: "Change the harness or provider of one of the two routes so that every label is unique.",
        message: `the route label "${label}" is already used by the route at ${owner}`,
      });
    }
  });
}

/**
 * The names a top-level declaration section declares. An absent section
 * declares nothing; a section that is present but not a JSON object is
 * already a shape problem, and references to it are skipped rather than
 * reported unknown, so undefined means "skip this kind".
 */
function declaredNames(section: unknown): ReadonlySet<string> | undefined {
  if (section === undefined) {
    return new Set<string>();
  }
  return isPlainObject(section) ? new Set(Object.keys(section)) : undefined;
}

/**
 * The declared benchmark names from calibration.benchmarks. Returns undefined
 * when the calibration section is absent or shaped wrongly (already a shape
 * problem), and the empty set on a `calibration` object with no benchmarks.
 */
function declaredBenchmarks(calibration: unknown): ReadonlySet<string> | undefined {
  if (calibration === undefined) {
    return new Set<string>();
  }
  if (!isPlainObject(calibration)) {
    return undefined;
  }
  const benchmarks = calibration.benchmarks;
  if (benchmarks === undefined) {
    return new Set<string>();
  }
  if (!isPlainObject(benchmarks)) {
    return undefined;
  }
  return new Set(Object.keys(benchmarks));
}

/**
 * The set of route labels the models section actually produces, including
 * labels from routes whose other facts are invalid. The check uses this set
 * to flag a figure or override that names a route the file never declared.
 */
function knownRouteLabels(root: Record<string, unknown>): ReadonlySet<string> {
  const labels = new Set<string>();
  forEachRoute(root, ({ modelKey, route }) => {
    if (typeof route.harness !== "string") {
      return;
    }
    if (Object.hasOwn(route, "provider") && typeof route.provider !== "string") {
      return;
    }
    labels.add(buildRouteLabel(modelKey, route as Pick<Route, "harness" | "provider">));
  });
  return labels;
}

/**
 * Check every reference the models and calibration sections carry. The check
 * runs on every load, including files whose shape already failed, so it
 * reads only what it can verify itself; one problem fires per bad
 * reference and the field is the JSONPath of the reference.
 */
function collectReferenceProblems(
  root: Record<string, unknown>,
  problems: RegistryProblem[],
): void {
  const declaredRatings = declaredNames(root.ratings);
  const declaredCapabilities = declaredNames(root.capabilities);
  const declaredMeters = declaredNames(root.meters);
  const benchmarks = declaredBenchmarks(root.calibration);
  const routeLabels = knownRouteLabels(root);

  const models = root.models;
  const declaredModelKeys = isPlainObject(models)
    ? new Set(Object.keys(models))
    : new Set<string>();
  if (!isPlainObject(models)) {
    return;
  }
  for (const [modelKey, modelValue] of Object.entries(models)) {
    if (!isPlainObject(modelValue)) {
      continue;
    }
    const modelPath = childPath("$", "models", modelKey);

    if (declaredRatings !== undefined && isPlainObject(modelValue.ratings)) {
      for (const rating of Object.keys(modelValue.ratings)) {
        if (!declaredRatings.has(rating)) {
          problems.push(
            referenceUnknownProblem({
              field: childPath(modelPath, "ratings", rating),
              kind: "rating",
              name: rating,
            }),
          );
        }
      }
    }
  }

  forEachRoute(root, ({ route, routePath }) => {
    if (declaredCapabilities !== undefined && Array.isArray(route.capabilities)) {
      route.capabilities.forEach((capability, capabilityIndex) => {
        if (typeof capability !== "string" || declaredCapabilities.has(capability)) {
          return;
        }
        problems.push(
          referenceUnknownProblem({
            field: childPath(routePath, "capabilities", capabilityIndex),
            kind: "capability",
            name: capability,
          }),
        );
      });
    }

    if (
      declaredMeters !== undefined &&
      typeof route.meter === "string" &&
      !declaredMeters.has(route.meter)
    ) {
      problems.push(
        referenceUnknownProblem({
          field: childPath(routePath, "meter"),
          kind: "meter",
          name: route.meter,
        }),
      );
    }
  });

  if (!isPlainObject(root.calibration)) {
    return;
  }
  if (declaredRatings === undefined || benchmarks === undefined) {
    return;
  }
  const calibration = root.calibration;

  if (isPlainObject(calibration.feeds)) {
    for (const [rating, feed] of Object.entries(calibration.feeds)) {
      if (rating !== ROUTE_RATING_NAME && !declaredRatings.has(rating)) {
        problems.push(
          referenceUnknownProblem({
            field: childPath("$", "calibration", "feeds", rating),
            kind: "rating",
            name: rating,
          }),
        );
        continue;
      }
      if (!Array.isArray(feed)) {
        continue;
      }
      feed.forEach((benchmarkName, benchmarkIndex) => {
        if (typeof benchmarkName !== "string" || benchmarks.has(benchmarkName)) {
          return;
        }
        problems.push(
          referenceUnknownProblem({
            field: childPath("$", "calibration", "feeds", rating, benchmarkIndex),
            kind: "benchmark",
            name: benchmarkName,
          }),
        );
      });
    }
  }

  if (Array.isArray(calibration.handSet)) {
    calibration.handSet.forEach((rating, index) => {
      if (typeof rating !== "string") {
        return;
      }
      // "cost" in handSet targets route.cost; every other name must be
      // declared in ratings.
      if (rating !== ROUTE_RATING_NAME && !declaredRatings.has(rating)) {
        problems.push(
          referenceUnknownProblem({
            field: childPath("$", "calibration", "handSet", index),
            kind: "rating",
            name: rating,
          }),
        );
      }
    });
  }

  if (Array.isArray(calibration.overrides)) {
    calibration.overrides.forEach((overrideValue, index) => {
      if (!isPlainObject(overrideValue)) {
        return;
      }
      const entryPath = childPath("$", "calibration", "overrides", index);
      if (typeof overrideValue.rating === "string") {
        if (
          overrideValue.rating !== ROUTE_RATING_NAME &&
          !declaredRatings.has(overrideValue.rating)
        ) {
          problems.push(
            referenceUnknownProblem({
              field: childPath(entryPath, "rating"),
              kind: "rating",
              name: overrideValue.rating,
            }),
          );
        }
      }
      if (typeof overrideValue.model === "string") {
        if (!declaredModelKeys.has(overrideValue.model)) {
          problems.push(
            referenceUnknownProblem({
              field: childPath(entryPath, "model"),
              kind: "model",
              name: overrideValue.model,
            }),
          );
        }
      }
      if (typeof overrideValue.route === "string") {
        if (!routeLabels.has(overrideValue.route)) {
          problems.push(
            referenceUnknownProblem({
              field: childPath(entryPath, "route"),
              kind: "route",
              name: overrideValue.route,
            }),
          );
        }
      }
      // The target must match its rating: cost in overrides targets
      // route.cost by route label, and every other rating is a model rating.
      if (overrideValue.rating === ROUTE_RATING_NAME && typeof overrideValue.model === "string") {
        problems.push(
          invalidProblem(
            childPath(entryPath, "model"),
            `the rating "cost" is reserved for route costs, so its override must name a route, not the model "${overrideValue.model}"`,
            'Remove the "model" field and set "route" to the label of the route whose cost is overridden.',
          ),
        );
      }
      if (
        typeof overrideValue.rating === "string" &&
        overrideValue.rating !== ROUTE_RATING_NAME &&
        typeof overrideValue.route === "string"
      ) {
        problems.push(
          invalidProblem(
            childPath(entryPath, "route"),
            `the rating "${overrideValue.rating}" is a model rating, so its override must name a model, not the route "${overrideValue.route}"`,
            'Remove the "route" field and set "model" to the key of the model whose rating is overridden.',
          ),
        );
      }
    });
  }

  // Figures may name models or routes the file does not declare; the schema
  // still checks their shape, and the rating check skips whatever subject it
  // cannot key. No reference check runs on them.
}

function buildRoutes(
  models: Record<string, Model>,
  routes: Record<RouteLabel, IndexedRoute>,
): void {
  for (const [modelKey, model] of Object.entries(models)) {
    if (!Array.isArray(model.routes)) {
      continue;
    }
    for (const route of model.routes) {
      safeSet(routes, buildRouteLabel(modelKey, route), { model: modelKey, ...route });
    }
  }
}

function failure(problem: RegistryProblem): ValidationResult {
  return { ok: false, problems: [problem] };
}

export function validateRegistry(
  root: unknown,
  steps: readonly MigrateStepEntry[] = MIGRATE_STEPS,
): ValidationResult {
  if (!isPlainObject(root)) {
    return failure(
      invalidProblem(
        "$",
        "the registry root must be a JSON object",
        "Give the file a JSON object with a format field and a models object.",
      ),
    );
  }

  if (!Object.hasOwn(root, "format")) {
    return failure({
      code: "format-missing",
      field: childPath("$", "format"),
      fix: 'Add "format": 1 at the top of the registry file.',
      message: "the file has no format field, so it is not a version 1 registry",
    });
  }

  const format = root.format;
  if (typeof format !== "number" || !Number.isInteger(format)) {
    return failure(
      invalidProblem(
        childPath("$", "format"),
        "the format field must be the integer 1",
        'Set "format": 1 at the top of the registry file.',
      ),
    );
  }
  if (format > CURRENT_FORMAT) {
    return failure({
      code: "format-unsupported",
      field: childPath("$", "format"),
      fix: `Upgrade model-registry to a release that supports format ${format}.`,
      message: `format ${format} is newer than the format ${CURRENT_FORMAT} this model-registry supports`,
    });
  }
  if (format < CURRENT_FORMAT) {
    return failure({
      code: "format-unsupported",
      field: childPath("$", "format"),
      fix: olderFormatFix(format, steps),
      message: `format ${format} is older than format ${CURRENT_FORMAT}`,
    });
  }

  const validateShape = getShapeValidator();
  const problems: RegistryProblem[] = [];
  if (!validateShape(root)) {
    problems.push(...curateProblems(root, validateShape.errors ?? []));
  }
  collectLabelProblems(root, problems);
  collectReferenceProblems(root, problems);

  // Rating check: whenever the file states a calibration section. Each part
  // guards locally, so a readable mismatch is reported beside unrelated
  // problems, and a malformed band, figure or override skips only what
  // depends on it.
  if (Object.hasOwn(root, "calibration")) {
    problems.push(
      ...collectRatingMismatchProblems({
        models: root.models,
        calibration: root.calibration,
      }),
    );
  }

  // The collected problems are returned before the typed index is built, so
  // index construction never dereferences a value the schema rejected.
  const [firstProblem, ...moreProblems] = problems;
  if (firstProblem !== undefined) {
    return { ok: false, problems: [firstProblem, ...moreProblems] };
  }

  // Build the typed index: sections stays foreign-only, calibration joins the
  // registry result after meters (RFC section order).
  const index: RegistryIndex = { registry: { models: {} }, routes: {}, sections: {} };
  for (const [key, value] of Object.entries(root)) {
    if (
      key === "format" ||
      key === "models" ||
      key === "ratings" ||
      key === "capabilities" ||
      key === "meters" ||
      key === "calibration"
    ) {
      continue;
    }
    safeSet(index.sections, key, value as JsonValue);
  }
  // The file passed the published schema, so every present declaration
  // section already has its declared shape.
  const models = root.models as Record<string, Model>;
  const registry: RegistryFacts = { models };
  if (Object.hasOwn(root, "ratings")) {
    safeSet(registry, "ratings", root.ratings as Readonly<Record<string, string>>);
  }
  if (Object.hasOwn(root, "capabilities")) {
    safeSet(registry, "capabilities", root.capabilities as Readonly<Record<string, string>>);
  }
  if (Object.hasOwn(root, "meters")) {
    safeSet(registry, "meters", root.meters as Readonly<Record<string, Meter>>);
  }
  if (Object.hasOwn(root, "calibration")) {
    // The schema validated the section whenever this index is returned, so
    // the raw JSON satisfies Calibration's shape.
    safeSet(registry, "calibration", root.calibration as Calibration);
  }
  index.registry = registry;
  if (isPlainObject(root.models)) {
    buildRoutes(models, index.routes);
  }

  return { ok: true, index };
}
