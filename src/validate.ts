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

const DEFERRED_TOP_LEVEL_FIELDS = new Set(["ratings", "capabilities", "meters", "calibration"]);

const DEFERRED_MODEL_FIELDS = new Set(["ratings", "maxEffort", "fixedEffort"]);

const DEFERRED_ROUTE_FIELDS = new Set(["capabilities", "meter"]);

const MODEL_FIELD_NAMES = new Set(["family", "notes", "routes"]);

const ROUTE_FIELD_NAMES = new Set([
  "harness",
  "modelId",
  "provider",
  "hosted",
  "privacyEligible",
  "cost",
  "rateLimitRpm",
  "responseSeconds",
  "notes",
]);

const LATER_SLICE_FIX =
  "Remove the field; support for it arrives in a later format slice of model-registry.";

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
    path += typeof part === "number" ? `[${part}]` : `["${part}"]`;
  }
  return path;
}

function childPath(parent: string, name: string): string {
  return `${parent}["${name}"]`;
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

function collectNullProblems(value: unknown, path: string, problems: RegistryProblem[]): void {
  if (value === null) {
    problems.push(
      invalidProblem(
        path,
        "null is not a valid value anywhere in a registry file",
        "Replace the null with the field's value, or remove the field.",
      ),
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectNullProblems(item, `${path}[${index}]`, problems);
    });
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectNullProblems(child, childPath(path, key), problems);
    }
  }
}

function checkRequiredString(
  container: Record<string, unknown>,
  name: string,
  parent: string,
  problems: RegistryProblem[],
): void {
  const path = childPath(parent, name);
  if (!Object.hasOwn(container, name)) {
    problems.push(
      invalidProblem(path, `the required field "${name}" is missing`, `Add a "${name}" string.`),
    );
  } else if (typeof container[name] !== "string") {
    problems.push(
      invalidProblem(path, `the field "${name}" must be a string`, `Set "${name}" to a string.`),
    );
  }
}

function checkRequiredBoolean(
  container: Record<string, unknown>,
  name: string,
  parent: string,
  problems: RegistryProblem[],
): void {
  const path = childPath(parent, name);
  if (!Object.hasOwn(container, name)) {
    problems.push(
      invalidProblem(
        path,
        `the required field "${name}" is missing`,
        `Add a "${name}" boolean; a wrong guess either way is a privacy fault.`,
      ),
    );
  } else if (typeof container[name] !== "boolean") {
    problems.push(
      invalidProblem(
        path,
        `the field "${name}" must be a boolean`,
        `Set "${name}" to true or false.`,
      ),
    );
  }
}

function checkOptionalString(
  container: Record<string, unknown>,
  name: string,
  parent: string,
  problems: RegistryProblem[],
): void {
  if (Object.hasOwn(container, name) && typeof container[name] !== "string") {
    problems.push(
      invalidProblem(
        childPath(parent, name),
        `the field "${name}" must be a string`,
        `Set "${name}" to a string, or remove it.`,
      ),
    );
  }
}

function checkOptionalBoolean(
  container: Record<string, unknown>,
  name: string,
  parent: string,
  problems: RegistryProblem[],
): void {
  if (Object.hasOwn(container, name) && typeof container[name] !== "boolean") {
    problems.push(
      invalidProblem(
        childPath(parent, name),
        `the field "${name}" must be a boolean`,
        `Set "${name}" to true or false, or remove it.`,
      ),
    );
  }
}

function checkOptionalCost(
  container: Record<string, unknown>,
  parent: string,
  problems: RegistryProblem[],
): void {
  if (!Object.hasOwn(container, "cost")) {
    return;
  }
  const value = container.cost;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    problems.push(
      invalidProblem(
        childPath(parent, "cost"),
        'the field "cost" must be an integer from 1 to 10',
        'Set "cost" to an integer from 1 (expensive) to 10 (cheap).',
      ),
    );
  }
}

function checkOptionalMetric(
  container: Record<string, unknown>,
  name: string,
  parent: string,
  problems: RegistryProblem[],
): void {
  if (!Object.hasOwn(container, name)) {
    return;
  }
  const value = container[name];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    problems.push(
      invalidProblem(
        childPath(parent, name),
        `the field "${name}" must be a number of 0 or more`,
        `Set "${name}" to a finite number of 0 or more.`,
      ),
    );
  }
}

function validateRoute(
  modelKey: string,
  index: number,
  routeValue: unknown,
  problems: RegistryProblem[],
  labelOwners: Map<RouteLabel, string>,
): void {
  const routePath = jsonPath("models", modelKey, "routes", index);
  if (!isPlainObject(routeValue)) {
    problems.push(
      invalidProblem(
        routePath,
        "the route must be a JSON object",
        "Replace the route with a JSON object.",
      ),
    );
    return;
  }

  checkRequiredString(routeValue, "harness", routePath, problems);
  checkRequiredString(routeValue, "modelId", routePath, problems);
  checkRequiredBoolean(routeValue, "hosted", routePath, problems);
  checkOptionalString(routeValue, "provider", routePath, problems);
  checkOptionalBoolean(routeValue, "privacyEligible", routePath, problems);
  checkOptionalCost(routeValue, routePath, problems);
  checkOptionalMetric(routeValue, "rateLimitRpm", routePath, problems);
  checkOptionalMetric(routeValue, "responseSeconds", routePath, problems);
  checkOptionalString(routeValue, "notes", routePath, problems);

  for (const key of Object.keys(routeValue)) {
    if (ROUTE_FIELD_NAMES.has(key)) {
      continue;
    }
    if (DEFERRED_ROUTE_FIELDS.has(key)) {
      problems.push(
        invalidProblem(
          childPath(routePath, key),
          `the field "${key}" is not supported in this release of model-registry`,
          LATER_SLICE_FIX,
        ),
      );
    } else {
      problems.push(
        invalidProblem(
          childPath(routePath, key),
          `the field "${key}" is not part of a format 1 route`,
          "Remove the field, or move free text into notes.",
        ),
      );
    }
  }

  // Duplicate detection continues whenever the label components are valid,
  // even when another fact on the route is invalid.
  const providerValid =
    !Object.hasOwn(routeValue, "provider") || typeof routeValue.provider === "string";
  if (typeof routeValue.harness === "string" && providerValid) {
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
  }
}

function validateModel(
  modelKey: string,
  modelValue: unknown,
  problems: RegistryProblem[],
  labelOwners: Map<RouteLabel, string>,
): void {
  const modelPath = jsonPath("models", modelKey);
  if (!isPlainObject(modelValue)) {
    problems.push(
      invalidProblem(
        modelPath,
        `the model "${modelKey}" must be a JSON object`,
        "Replace the model with a JSON object.",
      ),
    );
    return;
  }

  checkRequiredString(modelValue, "family", modelPath, problems);
  checkOptionalString(modelValue, "notes", modelPath, problems);

  for (const key of Object.keys(modelValue)) {
    if (MODEL_FIELD_NAMES.has(key)) {
      continue;
    }
    if (DEFERRED_MODEL_FIELDS.has(key)) {
      problems.push(
        invalidProblem(
          childPath(modelPath, key),
          `the field "${key}" is not supported in this release of model-registry`,
          LATER_SLICE_FIX,
        ),
      );
    } else {
      problems.push(
        invalidProblem(
          childPath(modelPath, key),
          `the field "${key}" is not part of a format 1 model`,
          "Remove the field, or move free text into notes.",
        ),
      );
    }
  }

  if (!Object.hasOwn(modelValue, "routes")) {
    problems.push(
      invalidProblem(
        childPath(modelPath, "routes"),
        `the model "${modelKey}" is missing the required field "routes"`,
        "Add a routes array to the model; an empty array is valid.",
      ),
    );
  } else if (!Array.isArray(modelValue.routes)) {
    problems.push(
      invalidProblem(
        childPath(modelPath, "routes"),
        "the routes field must be an array",
        "Set routes to an array of route objects.",
      ),
    );
  } else {
    (modelValue.routes as unknown[]).forEach((routeValue, index) => {
      validateRoute(modelKey, index, routeValue, problems, labelOwners);
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

  // Top-level scan: format and models are owned here, deferred owned fields
  // are rejected, and every other section passes through untouched after a
  // null check.
  for (const [key, value] of Object.entries(root)) {
    if (key === "format" || key === "models") {
      continue;
    }
    if (DEFERRED_TOP_LEVEL_FIELDS.has(key)) {
      problems.push(
        invalidProblem(
          jsonPath(key),
          `the field "${key}" is not supported in this release of model-registry`,
          LATER_SLICE_FIX,
        ),
      );
      continue;
    }
    collectNullProblems(value, jsonPath(key), problems);
    safeSet(index.sections, key, value as JsonValue);
  }

  if (!Object.hasOwn(root, "models")) {
    problems.push(
      invalidProblem(
        jsonPath("models"),
        'the required field "models" is missing',
        "Add a models object with one entry per model.",
      ),
    );
    return { problems, index };
  }
  if (!isPlainObject(root.models)) {
    problems.push(
      invalidProblem(
        jsonPath("models"),
        'the field "models" must be a JSON object keyed by model key',
        "Replace models with a JSON object keyed by model key.",
      ),
    );
    return { problems, index };
  }

  const models = root.models;
  const labelOwners = new Map<RouteLabel, string>();
  for (const [modelKey, modelValue] of Object.entries(models)) {
    validateModel(modelKey, modelValue, problems, labelOwners);
  }
  if (problems.length === 0) {
    index.registry = { models: models as unknown as Record<string, Model> };
    buildRoutes(models as unknown as Record<string, Model>, index.routes);
  }

  return { problems, index };
}
