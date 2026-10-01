import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../registry.schema.json" with { type: "json" };
import { buildRouteLabel } from "./label.js";
import { CURRENT_FORMAT, canMigrateFrom } from "./migrate-steps.js";
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

function olderFormatFix(format: number): string {
  if (canMigrateFrom(format)) {
    return `Run model-registry migrate to upgrade the file from format ${format} to format ${CURRENT_FORMAT}.`;
  }
  return `Recreate the file as a format ${CURRENT_FORMAT} registry; no migration step from format ${format} ships in this release.`;
}

function invalidProblem(field: string, message: string, fix: string): RegistryProblem {
  return { code: "registry-invalid", field, fix, message };
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
  return pointer === "" || pointerSegments(pointer)[0] === "models";
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
  owner: "model" | "route",
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

const ROOT_FIELD_DEPTH = 1;
const MODEL_DEPTH = 2;
const MODEL_FIELD_DEPTH = 3;
const ROUTE_DEPTH = 4;
const ROUTE_FIELD_DEPTH = 5;

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

  return genericProblem(path, error.message);
}

function typeProblem(segments: string[], path: string): RegistryProblem | undefined {
  const field = segments.at(-1) ?? "";
  if (segments.length === ROOT_FIELD_DEPTH && field === "models") {
    return invalidProblem(
      path,
      'the field "models" must be a JSON object keyed by model key',
      "Replace models with a JSON object keyed by model key.",
    );
  }
  if (segments.length === MODEL_DEPTH) {
    return invalidProblem(
      path,
      `the model "${segments[1] ?? ""}" must be a JSON object`,
      "Replace the model with a JSON object.",
    );
  }
  if (segments.length === MODEL_FIELD_DEPTH) {
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
    }
    return undefined;
  }
  if (segments.length === ROUTE_DEPTH) {
    return invalidProblem(
      path,
      "the route must be a JSON object",
      "Replace the route with a JSON object.",
    );
  }
  if (segments.length === ROUTE_FIELD_DEPTH) {
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
    }
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
      fix: olderFormatFix(format),
      message: `format ${format} is older than format ${CURRENT_FORMAT}`,
    });
  }

  const validateShape = getShapeValidator();
  const problems: RegistryProblem[] = [];
  if (!validateShape(root)) {
    problems.push(...curateProblems(root, validateShape.errors ?? []));
  }
  collectLabelProblems(root, problems);

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
