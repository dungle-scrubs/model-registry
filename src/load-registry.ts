import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { RegistryError } from "./error.js";
import { resolveRegistryPath } from "./path.js";
import type {
  LoadedRegistry,
  LoadRegistryOptions,
  RegistryDigest,
  RegistryProblem,
} from "./types.js";
import { aggregateCode, validateRegistry } from "./validate.js";

const EXAMPLE_PATH = "examples/registry.json";

export interface ReadRegistryFile {
  path: string;
  bytes: Buffer;
  parsed: unknown;
}

/**
 * Resolve the registry path, read the file as bytes, and parse it as JSON.
 * The failures here use the same codes and messages as `check`: missing,
 * unreadable, not JSON. Validation is left to the caller so the migrate
 * command can apply migration steps first.
 */
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

  let parsed: unknown;
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

/** Format the SHA-256 digest of a byte payload the way the commands print it. */
export function digestOf(bytes: Buffer): RegistryDigest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Build the one RegistryError that reports every validation problem a
 * command found. A single problem passes its own message and fix through;
 * several problems roll up into one envelope naming the command to re-run.
 */
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

/**
 * Load a registry file synchronously. The file is read once as bytes, the
 * digest covers those bytes as read, and the registry file is never changed.
 * On failure one RegistryError carries every collected problem.
 */
export function loadRegistry(options: LoadRegistryOptions = {}): LoadedRegistry {
  const { path, bytes, parsed } = readRegistryFile(options.path);

  const result = validateRegistry(parsed);
  if (!result.ok) {
    throw registryErrorForProblems(path, result.problems, "check");
  }

  const digest: RegistryDigest = digestOf(bytes);
  return {
    format: 1,
    digest,
    path,
    registry: result.index.registry,
    routes: result.index.routes,
    sections: result.index.sections,
  };
}
