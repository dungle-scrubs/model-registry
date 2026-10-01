import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { RegistryError } from "./error.js";
import { CURRENT_FORMAT } from "./migrate-steps.js";
import { resolveRegistryPath } from "./path.js";
import type {
  JsonValue,
  LoadedRegistry,
  LoadRegistryOptions,
  RegistryDigest,
  RegistryProblem,
} from "./types.js";
import { aggregateCode, type RegistryIndex, validateRegistry } from "./validate.js";

const EXAMPLE_PATH = "examples/registry.json";

export interface ReadRegistryFile {
  path: string;
  bytes: Buffer;
  parsed: JsonValue;
}

export function readRegistryFile(explicit?: string): ReadRegistryFile {
  if (explicit === "") {
    throw new RegistryError({
      code: "registry-missing",
      fix: `Give a registry path, or check an example by running model-registry check --registry ${EXAMPLE_PATH}.`,
      message: "no registry file was given, because the path is empty",
      path: "",
      problems: [],
    });
  }
  const path = resolveRegistryPath(explicit);

  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new RegistryError({
        code: "registry-missing",
        fix: `Create the file, or check an example by running model-registry check --registry ${EXAMPLE_PATH}.`,
        message: `no registry file exists at "${path}"`,
        path,
        problems: [],
      });
    }
    throw new RegistryError({
      code: "registry-unreadable",
      fix: "Make the file a readable file, then run model-registry check again.",
      message: `the registry file at "${path}" cannot be read`,
      path,
      problems: [],
    });
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new RegistryError({
      code: "registry-unreadable",
      fix: "Fix the JSON syntax, then run model-registry check again.",
      message: `the registry file at "${path}" is not valid JSON`,
      path,
      problems: [],
    });
  }

  return { path, bytes, parsed };
}

export function digestOf(bytes: Buffer): RegistryDigest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function registryErrorForProblems(
  path: string,
  problems: readonly [RegistryProblem, ...RegistryProblem[]],
  commandName: string,
): RegistryError {
  return new RegistryError({
    code: aggregateCode(problems),
    fix:
      problems.length === 1
        ? problems[0].fix
        : `Fix each problem listed in problems, then run model-registry ${commandName} again.`,
    message:
      problems.length === 1
        ? problems[0].message
        : `the registry file at "${path}" has ${problems.length} problems`,
    path,
    problems: [...problems],
  });
}

export type CheckedRegistry =
  | { readonly ok: true; readonly index: RegistryIndex }
  | { readonly ok: false; readonly error: RegistryError };

export function checkParsedRegistry(
  path: string,
  value: JsonValue,
  commandName: string,
): CheckedRegistry {
  const result = validateRegistry(value);
  if (result.ok) {
    return { ok: true, index: result.index };
  }
  return { ok: false, error: registryErrorForProblems(path, result.problems, commandName) };
}

/**
 * Load a registry file synchronously. The file is read once as bytes, the
 * digest covers those bytes as read, and the registry file is never changed.
 * On failure one RegistryError carries every collected problem.
 */
export function loadRegistry(options: LoadRegistryOptions = {}): LoadedRegistry {
  const { path, bytes, parsed } = readRegistryFile(options.path);

  const checked = checkParsedRegistry(path, parsed, "check");
  if (!checked.ok) {
    throw checked.error;
  }

  const digest: RegistryDigest = digestOf(bytes);
  return {
    format: CURRENT_FORMAT,
    digest,
    path,
    registry: checked.index.registry,
    routes: checked.index.routes,
    sections: checked.index.sections,
  };
}
