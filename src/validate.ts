import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../registry.schema.json" with { type: "json" };
import { buildRouteLabel } from "./label.js";
import { EFFORT_LADDER } from "./ladder.js";
import type {
  IndexedRoute,
  JsonValue,
  Model,
  RegistryErrorCode,
  RegistryFacts,
  RegistryProblem,
  Route,
  RouteLabel,
} from "./types.js";
import { DECLARATION_SECTIONS } from "./types.js";

export interface RegistryIndex {
  registry: RegistryFacts;
  routes: Record<RouteLabel, IndexedRoute>;
  sections: Record<string, JsonValue>;
}

export type ValidationResult =
  | { index: RegistryIndex; ok: true }
  | { ok: false; problems: readonly [RegistryProblem, ...RegistryProblem[]] };

const LATER_SLICE_FIX =
  "Remove the field; support for it arrives in a later format slice of model-registry.";
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

function invalidProblem(field: string, message: string, fix: string): RegistryProblem {
  return { code: "registry-invalid", field, fix, message };
}

const REFERENCE_TARGETS = {
  capability: { owner: "route", section: "capabilities" },
  meter: { owner: "route", section: "meters" },
  rating: { owner: "model", section: "ratings" },
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
  return head === undefined || head === "models" || isDeclarationSection(head);
}

function genericProblem(field: string, message: string | undefined): RegistryProblem {
  return invalidProblem(
    field,
    message ?? "the registry does not match the published schema",
    "Fix the registry so it matches registry.schema.json, the published format 1 schema.",
  );
}

function deferredProblem(path: string, field: string): RegistryProblem {
  return invalidProblem(
    path,
    `the field "${field}" is not supported in this release of model-registry`,
    LATER_SLICE_FIX,
  );
}

function unknownFieldProblem(
  path: string,
  name: string,
  owner: "model" | "route" | "meter",
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
  | { kind: "section"; section: "capabilities" | "meters" | "models" | "ratings" };

function classifyPath(segments: readonly string[]): OwnedPath {
  const [section, name, container, index, field] = segments;
  const inModelsRoutes = section === "models" && container === "routes" && index !== undefined;
  switch (segments.length) {
    case 0:
      return { kind: "root" };
    case 1:
      switch (section) {
        case "capabilities":
        case "meters":
        case "models":
        case "ratings":
          return { kind: "section", section };
        default:
          return { kind: "other" };
      }
    case 2:
      switch (section) {
        case "models":
          return { kind: "model", modelKey: name ?? "" };
        case "meters":
          return { kind: "meter", meterName: name ?? "" };
        case "capabilities":
        case "ratings":
          return { kind: "declaration", name: name ?? "", section };
        default:
          return { kind: "other" };
      }
    case 3:
      if (section === "meters") {
        return { field: container ?? "", kind: "meterField", meterName: name ?? "" };
      }
      if (section === "models") {
        return { field: container ?? "", kind: "modelField", modelKey: name ?? "" };
      }
      return { kind: "other" };
    case 4:
      if (section === "models" && container === "ratings") {
        return { kind: "modelRating", modelKey: name ?? "", rating: index ?? "" };
      }
      if (section === "models" && container === "routes") {
        return { kind: "route" };
      }
      return { kind: "other" };
    case 5:
      if (inModelsRoutes) {
        return { field: field ?? "", kind: "routeField" };
      }
      return { kind: "other" };
    case 6:
      if (inModelsRoutes && field === "capabilities") {
        return { kind: "routeCapabilityEntry" };
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
  }
  return genericProblem(path, error.message);
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
    default:
      return undefined;
  }
}

/**
 * Foreign sections are validated by the recursive jsonValue definition, and
 * Ajv reports the failing branch at every ancestor level, so only the deepest
 * anyOf error of each branch points at the offending value itself.
 */
function deferredFieldProblems(
  root: unknown,
  errors: readonly ErrorObject[],
  push: (problem: RegistryProblem) => void,
): void {
  for (const error of errors) {
    if (error.keyword !== "false schema") {
      continue;
    }
    const segments = pointerSegments(error.instancePath);
    push(deferredProblem(walkSegments(root, segments).path, segments.at(-1) ?? ""));
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

  deferredFieldProblems(root, errors, push);

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
    if (
      error.keyword === "anyOf" ||
      error.keyword === "false schema" ||
      !pointerIsOwned(error.instancePath)
    ) {
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
 * Check every reference the models section makes: model ratings against
 * ratings, route capabilities against capabilities and route meters against
 * meters. The check runs on every load, including files whose shape already
 * failed, so it reads only what it can verify itself; one problem fires per
 * bad reference and the field is the JSONPath of the reference.
 */
function collectReferenceProblems(
  root: Record<string, unknown>,
  problems: RegistryProblem[],
): void {
  const declaredRatings = declaredNames(root.ratings);
  const declaredCapabilities = declaredNames(root.capabilities);
  const declaredMeters = declaredNames(root.meters);

  const models = root.models;
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
}

function buildRoutes(
  models: Record<string, Model>,
  routes: Record<RouteLabel, IndexedRoute>,
): void {
  for (const [modelKey, model] of Object.entries(models)) {
    for (const route of model.routes) {
      safeSet(routes, buildRouteLabel(modelKey, route), { model: modelKey, ...route });
    }
  }
}

function failure(problem: RegistryProblem): ValidationResult {
  return { ok: false, problems: [problem] };
}

export function validateRegistry(root: unknown): ValidationResult {
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
  if (format > 1) {
    return failure({
      code: "format-unsupported",
      field: childPath("$", "format"),
      fix: `Upgrade model-registry to a release that supports format ${format}.`,
      message: `format ${format} is newer than the format 1 this model-registry supports`,
    });
  }
  if (format < 1) {
    return failure({
      code: "format-unsupported",
      field: childPath("$", "format"),
      fix: "Recreate the file as a format 1 registry; no migration into format 1 ships.",
      message: `format ${format} is older than format 1`,
    });
  }

  const validateShape = getShapeValidator();
  const problems: RegistryProblem[] = [];
  if (!validateShape(root)) {
    problems.push(...curateProblems(root, validateShape.errors ?? []));
  }
  collectLabelProblems(root, problems);
  collectReferenceProblems(root, problems);

  const [firstProblem, ...moreProblems] = problems;
  if (firstProblem !== undefined) {
    return { ok: false, problems: [firstProblem, ...moreProblems] };
  }

  const index: RegistryIndex = { registry: { models: {} }, routes: {}, sections: {} };
  for (const [key, value] of Object.entries(root)) {
    if (key === "format" || key === "models" || isDeclarationSection(key)) {
      continue;
    }
    safeSet(index.sections, key, value as JsonValue);
  }
  // The file passed the published schema, so every present declaration
  // section already has its declared shape.
  const models = root.models as Record<string, Model>;
  const registry: RegistryFacts = { models };
  for (const section of DECLARATION_SECTIONS) {
    if (Object.hasOwn(root, section)) {
      safeSet(registry, section, root[section]);
    }
  }
  index.registry = registry;
  buildRoutes(models, index.routes);
  return { ok: true, index };
}
