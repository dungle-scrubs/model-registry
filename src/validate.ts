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
export function safeSet<TValue>(target: Record<string, TValue>, key: string, value: TValue): void {
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

function referenceUnknownProblem(
  field: string,
  name: string,
  kind: string,
  fix: string,
): RegistryProblem {
  return {
    code: "reference-unknown",
    field,
    fix,
    message: `the ${kind} "${name}" is not declared in the ${kind}s section`,
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

function pointerIsOwned(pointer: string): boolean {
  return (
    pointer === "" ||
    pointerSegments(pointer)[0] === "models" ||
    pointerSegments(pointer)[0] === "ratings" ||
    pointerSegments(pointer)[0] === "capabilities" ||
    pointerSegments(pointer)[0] === "meters"
  );
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

// Path depth in segments for each owned level. The values are computed once so
// the depth checks in the keyword handlers below stay readable.
const MODEL_DEPTH = 2;
const ROUTE_DEPTH = 4;

function ratingValueProblem(path: string, segments: readonly string[]): RegistryProblem {
  const modelKey = segments[1] ?? "";
  const rating = segments[3] ?? "";
  return invalidProblem(
    path,
    `the rating "${rating}" of model "${modelKey}" must be an integer from 1 to 10`,
    `Set the rating "${rating}" of model "${modelKey}" to an integer from 1 to 10.`,
  );
}

function enumProblem(path: string, segments: readonly string[]): RegistryProblem | undefined {
  const field = segments.at(-1) ?? "";
  if (segments.length === 3 && (field === "maxEffort" || field === "fixedEffort")) {
    return invalidProblem(
      path,
      `the field "${field}" must be one of ${EFFORT_LADDER_VALUES}`,
      `Set "${field}" to one of ${EFFORT_LADDER_VALUES}.`,
    );
  }
  return undefined;
}

function ownedProblem(root: unknown, error: ErrorObject): RegistryProblem {
  const segments = pointerSegments(error.instancePath);
  const path = walkSegments(root, segments).path;
  const keyword = error.keyword;

  if (keyword === "required") {
    const missing = error.params.missingProperty;
    if (typeof missing === "string") {
      if (segments.length === 0 && missing === "models") {
        return invalidProblem(
          childPath(path, "models"),
          'the required field "models" is missing',
          "Add a models object with one entry per model.",
        );
      }
      if (segments.length === MODEL_DEPTH && missing === "family") {
        return requiredStringProblem(path, "family");
      }
      if (segments.length === MODEL_DEPTH && missing === "routes") {
        return invalidProblem(
          childPath(path, "routes"),
          `the model "${segments[1] ?? ""}" is missing the required field "routes"`,
          "Add a routes array to the model; an empty array is valid.",
        );
      }
      if (segments.length === ROUTE_DEPTH && missing === "harness") {
        return requiredStringProblem(path, "harness");
      }
      if (segments.length === ROUTE_DEPTH && missing === "modelId") {
        return requiredStringProblem(path, "modelId");
      }
      if (segments.length === ROUTE_DEPTH && missing === "hosted") {
        return invalidProblem(
          childPath(path, "hosted"),
          'the required field "hosted" is missing',
          'Add a "hosted" boolean; a wrong guess either way is a privacy fault.',
        );
      }
    }
    return genericProblem(path, error.message);
  }

  if (keyword === "additionalProperties") {
    const name = error.params.additionalProperty;
    if (typeof name === "string" && segments.length === 2 && (segments[0] ?? "") === "meters") {
      return unknownFieldProblem(path, name, "meter");
    }
    if (typeof name === "string" && segments.length === MODEL_DEPTH) {
      return unknownFieldProblem(path, name, "model");
    }
    if (typeof name === "string" && segments.length === ROUTE_DEPTH) {
      return unknownFieldProblem(path, name, "route");
    }
    return genericProblem(path, error.message);
  }

  if (keyword === "type" || keyword === "minimum" || keyword === "maximum") {
    return typeProblem(segments, path) ?? genericProblem(path, error.message);
  }

  if (keyword === "enum") {
    return enumProblem(path, segments) ?? genericProblem(path, error.message);
  }

  if (keyword === "const") {
    if (
      segments.length === 3 &&
      (segments[0] ?? "") === "meters" &&
      (segments.at(-1) ?? "") === "spendToZero"
    ) {
      const meterName = segments[1] ?? "";
      return invalidProblem(
        path,
        `the meter "${meterName}" field "spendToZero" accepts only the literal true`,
        'Set "spendToZero" to true, or remove it.',
      );
    }
    return genericProblem(path, error.message);
  }

  return genericProblem(path, error.message);
}

function typeProblem(segments: string[], path: string): RegistryProblem | undefined {
  const field = segments.at(-1) ?? "";
  const section = segments[0] ?? "";

  if (segments.length === 1) {
    switch (field) {
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
  }
  if (segments.length === 2) {
    const name = segments[1] ?? "";
    if (section === "meters") {
      return invalidProblem(
        path,
        `the meter "${name}" must be a JSON object`,
        "Replace the meter value with a JSON object.",
      );
    }
    if (section === "models") {
      return invalidProblem(
        path,
        `the model "${name}" must be a JSON object`,
        "Replace the model with a JSON object.",
      );
    }
    return undefined;
  }
  if (segments.length === 3 && section === "meters") {
    switch (field) {
      case "notes":
        return invalidProblem(
          path,
          `the meter "${segments[1] ?? ""}" field "notes" must be a string`,
          `Set the meter "${segments[1] ?? ""}" notes to a string, or remove it.`,
        );
    }
    return undefined;
  }
  if (segments.length === 3 && section === "models") {
    const modelKey = segments[1] ?? "";
    switch (field) {
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
          `the model "${modelKey}" ratings field must be a JSON object`,
          `Set the model "${modelKey}" ratings to a JSON object of integer ratings.`,
        );
      case "maxEffort":
      case "fixedEffort":
        return invalidProblem(
          path,
          `the field "${field}" must be one of ${EFFORT_LADDER_VALUES}`,
          `Set "${field}" to one of ${EFFORT_LADDER_VALUES}.`,
        );
    }
    return undefined;
  }
  if (segments.length === 4 && section === "models" && (segments[2] ?? "") === "ratings") {
    return ratingValueProblem(path, segments);
  }
  if (segments.length === 4 && section === "models" && (segments[2] ?? "") === "routes") {
    return invalidProblem(
      path,
      "the route must be a JSON object",
      "Replace the route with a JSON object.",
    );
  }
  if (segments.length === 5) {
    switch (field) {
      case "harness":
      case "modelId":
        return invalidProblem(
          path,
          `the field "${field}" must be a string`,
          `Set "${field}" to a string.`,
        );
      case "provider":
      case "notes":
        return invalidProblem(
          path,
          `the field "${field}" must be a string`,
          `Set "${field}" to a string, or remove it.`,
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
          `the field "${field}" must be a number of 0 or more`,
          `Set "${field}" to a finite number of 0 or more.`,
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
  }
  if (segments.length === 6) {
    return invalidProblem(
      path,
      "a route capability entry must be a string",
      "Set the entry to a capability name declared in the capabilities section, or remove the entry.",
    );
  }
  return undefined;
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

/**
 * Report duplicate labels wherever the label components are readable, even
 * when another fact on the same route is invalid. This is a semantic check;
 * the schema cannot express it.
 */
function collectLabelProblems(root: Record<string, unknown>, problems: RegistryProblem[]): void {
  const models = root.models;
  if (!isPlainObject(models)) {
    return;
  }
  const labelOwners = new Map<RouteLabel, string>();
  for (const [modelKey, modelValue] of Object.entries(models)) {
    if (!isPlainObject(modelValue) || !Array.isArray(modelValue.routes)) {
      continue;
    }
    modelValue.routes.forEach((routeValue, index) => {
      if (!isPlainObject(routeValue)) {
        return;
      }
      const providerValid =
        !Object.hasOwn(routeValue, "provider") || typeof routeValue.provider === "string";
      if (typeof routeValue.harness !== "string" || !providerValid) {
        return;
      }
      const routePath = childPath("$", "models", modelKey, "routes", index);
      const label = buildRouteLabel(modelKey, routeValue as Pick<Route, "harness" | "provider">);
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
}

/**
 * Verify every name the registry mentions against the top-level declarations:
 * model ratings against the ratings section, route capabilities against the
 * capabilities section and route meters against the meters section. An absent
 * section declares nothing, so every reference becomes unknown. The check runs
 * after shape validation so the values are known to be strings; one problem
 * fires per bad reference and the field is the JSONPath of the reference.
 */
function collectReferenceProblems(
  root: Record<string, unknown>,
  problems: RegistryProblem[],
): void {
  const declaredRatings = isPlainObject(root.ratings)
    ? new Set(Object.keys(root.ratings))
    : new Set<string>();
  const declaredCapabilities = isPlainObject(root.capabilities)
    ? new Set(Object.keys(root.capabilities))
    : new Set<string>();
  const declaredMeters = isPlainObject(root.meters)
    ? new Set(Object.keys(root.meters))
    : new Set<string>();

  const models = root.models;
  if (!isPlainObject(models)) {
    return;
  }
  for (const [modelKey, modelValue] of Object.entries(models)) {
    if (!isPlainObject(modelValue)) {
      continue;
    }
    const modelPath = childPath("$", "models", modelKey);

    if (isPlainObject(modelValue.ratings)) {
      for (const rating of Object.keys(modelValue.ratings)) {
        if (!declaredRatings.has(rating)) {
          problems.push(
            referenceUnknownProblem(
              childPath(modelPath, "ratings", rating),
              rating,
              "rating",
              `Add "${rating}" to the ratings section, or remove the rating from model "${modelKey}".`,
            ),
          );
        }
      }
    }

    if (!Array.isArray(modelValue.routes)) {
      continue;
    }
    modelValue.routes.forEach((routeValue, index) => {
      if (!isPlainObject(routeValue)) {
        return;
      }
      const routePath = childPath(modelPath, "routes", index);

      if (Array.isArray(routeValue.capabilities)) {
        routeValue.capabilities.forEach((capability, capabilityIndex) => {
          if (typeof capability !== "string" || declaredCapabilities.has(capability)) {
            return;
          }
          problems.push(
            referenceUnknownProblem(
              childPath(routePath, "capabilities", capabilityIndex),
              capability,
              "capability",
              `Add "${capability}" to the capabilities section, or remove it from this route.`,
            ),
          );
        });
      }

      if (typeof routeValue.meter === "string" && !declaredMeters.has(routeValue.meter)) {
        problems.push(
          referenceUnknownProblem(
            childPath(routePath, "meter"),
            routeValue.meter,
            "meter",
            `Add "${routeValue.meter}" to the meters section, or remove it from this route.`,
          ),
        );
      }
    });
  }
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
    if (key === "format" || key === "models") {
      continue;
    }
    safeSet(index.sections, key, value as JsonValue);
  }
  const models = root.models as Record<string, Model>;
  index.registry = { models };
  buildRoutes(models, index.routes);
  return { ok: true, index };
}
