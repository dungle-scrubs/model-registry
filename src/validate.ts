import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../registry.schema.json" with { type: "json" };
import { buildRouteLabel } from "./label.js";
import type {
  IndexedRoute,
  JsonValue,
  Model,
  RegistryErrorCode,
  RegistryFacts,
  RegistryProblem,
  RouteLabel,
} from "./types.js";

export interface RegistryIndex {
  registry: RegistryFacts;
  routes: Record<RouteLabel, IndexedRoute>;
  sections: Record<string, JsonValue>;
}

export interface ValidationResult {
  problems: RegistryProblem[];
  index: RegistryIndex;
}

const LATER_SLICE_FIX =
  "Remove the field; support for it arrives in a later format slice of model-registry.";

// The published schema is the one runtime shape validator. allErrors
// collects every fault in one pass and strictNumbers rejects non-finite
// numbers, such as the Infinity JSON.parse builds from 1e400. Coercion,
// defaults and removal of unknown properties stay disabled.
const ajv = new Ajv2020({ allErrors: true, strictNumbers: true });
const validateShape = ajv.compile(schema);

interface ShapeError {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Define a property without routing a key such as `__proto__` through the prototype setter. */
export function safeSet<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function jsonPath(...parts: Array<string | number>): string {
  let path = "$";
  for (const part of parts) {
    path += typeof part === "number" ? `[${part}]` : `[${JSON.stringify(part)}]`;
  }
  return path;
}

function childPath(parent: string, name: string): string {
  return `${parent}[${JSON.stringify(name)}]`;
}

function invalidProblem(field: string, message: string, fix: string): RegistryProblem {
  return { code: "registry-invalid", field, message, fix };
}

/** The aggregate code: the shared code when every problem has one, otherwise registry-invalid. */
export function aggregateCode(problems: RegistryProblem[]): RegistryErrorCode {
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

/** Read the value the decoded segments point at; prototype keys are never read. */
function valueAt(root: unknown, segments: string[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isPlainObject(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Build the quoted JSONPath for decoded segments, walking the value so array
 * positions stay bare numbers and every property name is encoded with
 * JSON.stringify. Quotes, backslashes and control characters in a key stay
 * readable in the result.
 */
function segmentsToPath(root: unknown, segments: string[]): string {
  let path = "$";
  let container: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(container)) {
      path += `[${segment}]`;
      container = container[Number(segment)];
    } else {
      path += `[${JSON.stringify(segment)}]`;
      container =
        isPlainObject(container) && Object.hasOwn(container, segment)
          ? container[segment]
          : undefined;
    }
  }
  return path;
}

/** Owned structure lives at the root and under models; every other section is foreign. */
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

/** Curate one schema error at an owned location, by the shape of its pointer. */
function ownedProblem(root: unknown, error: ShapeError): RegistryProblem {
  const segments = pointerSegments(error.instancePath);
  const path = segmentsToPath(root, segments);
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
      if (segments.length === 2 && missing === "family") {
        return requiredStringProblem(path, "family");
      }
      if (segments.length === 2 && missing === "routes") {
        return invalidProblem(
          childPath(path, "routes"),
          `the model "${segments[1] ?? ""}" is missing the required field "routes"`,
          "Add a routes array to the model; an empty array is valid.",
        );
      }
      if (segments.length === 4 && missing === "harness") {
        return requiredStringProblem(path, "harness");
      }
      if (segments.length === 4 && missing === "modelId") {
        return requiredStringProblem(path, "modelId");
      }
      if (segments.length === 4 && missing === "hosted") {
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
    if (typeof name === "string" && segments.length === 2) {
      return unknownFieldProblem(path, name, "model");
    }
    if (typeof name === "string" && segments.length === 4) {
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
  if (segments.length === 1 && field === "models") {
    return invalidProblem(
      path,
      'the field "models" must be a JSON object keyed by model key',
      "Replace models with a JSON object keyed by model key.",
    );
  }
  if (segments.length === 2) {
    return invalidProblem(
      path,
      `the model "${segments[1] ?? ""}" must be a JSON object`,
      "Replace the model with a JSON object.",
    );
  }
  if (segments.length === 3) {
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
  if (segments.length === 4) {
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
    }
  }
  return undefined;
}

/**
 * Translate the schema's errors into curated problems. Foreign sections are
 * validated by the recursive jsonValue definition, and Ajv reports the
 * failing branch at every ancestor level, so only the deepest anyOf error
 * of each branch points at the offending value itself.
 */
function curateProblems(root: unknown, errors: readonly ShapeError[]): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const seen = new Set<string>();
  const push = (problem: RegistryProblem) => {
    const key = `${problem.code} ${problem.field}`;
    if (!seen.has(key)) {
      seen.add(key);
      problems.push(problem);
    }
  };

  // A boolean false schema marks one deferred owned field. The schema only
  // declares false properties at owned levels, so the pointer needs no
  // owned-or-foreign test here; the root's deferred sections sit at a
  // top-level pointer such as /ratings.
  for (const error of errors) {
    if (error.keyword !== "false schema") {
      continue;
    }
    const segments = pointerSegments(error.instancePath);
    push(deferredProblem(segmentsToPath(root, segments), segments.at(-1) ?? ""));
  }

  const foreignAnyOf = errors.filter(
    (error) => error.keyword === "anyOf" && !pointerIsOwned(error.instancePath),
  );
  for (const error of foreignAnyOf) {
    const deeper = foreignAnyOf.some(
      (other) => other !== error && other.instancePath.startsWith(`${error.instancePath}/`),
    );
    if (deeper) {
      continue;
    }
    const segments = pointerSegments(error.instancePath);
    const field = segmentsToPath(root, segments);
    const value = valueAt(root, segments);
    if (value === null) {
      push(
        invalidProblem(
          field,
          "null is not a valid value anywhere in a registry file",
          "Replace the null with the field's value, or remove the field.",
        ),
      );
    } else if (typeof value === "number") {
      push(
        invalidProblem(
          field,
          "numbers in a registry file must be finite",
          "Rewrite the number so it stays within double-precision range, for example 1e308 rather than 1e400.",
        ),
      );
    } else {
      push(genericProblem(field, error.message));
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
      const routePath = jsonPath("models", modelKey, "routes", index);
      const label = buildRouteLabel(modelKey, routeValue as { harness: string; provider?: string });
      const owner = labelOwners.get(label);
      if (owner === undefined) {
        labelOwners.set(label, routePath);
      } else {
        problems.push({
          code: "label-duplicate",
          field: routePath,
          message: `the route label "${label}" is already used by the route at ${owner}`,
          fix: "Change the harness or provider of one of the two routes so that every label is unique.",
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

export function validateRegistry(root: unknown): ValidationResult {
  const problems: RegistryProblem[] = [];
  const index: RegistryIndex = { registry: { models: {} }, routes: {}, sections: {} };

  if (!isPlainObject(root)) {
    problems.push(
      invalidProblem(
        "$",
        "the registry root must be a JSON object",
        "Give the file a JSON object with a format field and a models object.",
      ),
    );
    return { problems, index };
  }

  if (!Object.hasOwn(root, "format")) {
    problems.push({
      code: "format-missing",
      field: jsonPath("format"),
      message: "the file has no format field, so it is not a version 1 registry",
      fix: 'Add "format": 1 at the top of the registry file.',
    });
    return { problems, index };
  }

  const format = root.format;
  if (typeof format !== "number" || !Number.isInteger(format)) {
    problems.push(
      invalidProblem(
        jsonPath("format"),
        "the format field must be the integer 1",
        'Set "format": 1 at the top of the registry file.',
      ),
    );
    return { problems, index };
  }
  if (format > 1) {
    problems.push({
      code: "format-unsupported",
      field: jsonPath("format"),
      message: `format ${format} is newer than the format 1 this model-registry supports`,
      fix: `Upgrade model-registry to a release that supports format ${format}.`,
    });
    return { problems, index };
  }
  if (format < 1) {
    problems.push({
      code: "format-unsupported",
      field: jsonPath("format"),
      message: `format ${format} is older than format 1`,
      fix: "Recreate the file as a format 1 registry; no migration into format 1 ships.",
    });
    return { problems, index };
  }

  // The published schema decides every shape question after the format
  // checks; duplicate labels stay a semantic check in this module.
  if (!validateShape(root)) {
    problems.push(...curateProblems(root, validateShape.errors ?? []));
  }
  collectLabelProblems(root, problems);

  if (problems.length === 0) {
    for (const [key, value] of Object.entries(root)) {
      if (key === "format" || key === "models") {
        continue;
      }
      safeSet(index.sections, key, value as JsonValue);
    }
    const models = root.models as Record<string, Model>;
    index.registry = { models };
    buildRoutes(models, index.routes);
  }

  return { problems, index };
}
