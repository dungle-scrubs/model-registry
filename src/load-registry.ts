import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { RegistryError } from "./error.js";
import { resolveRegistryPath } from "./path.js";
import type { LoadedRegistry, LoadRegistryOptions, RegistryDigest } from "./types.js";
import { aggregateCode, validateRegistry } from "./validate.js";

const EXAMPLE_PATH = "examples/registry.json";

interface NodeError extends Error {
  code?: string;
}

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error;
}

/**
 * Load a registry file synchronously. The file is read once as bytes, the
 * digest covers those bytes as read, and the registry file is never changed.
 * On failure one RegistryError carries every collected problem.
 */
export function loadRegistry(options: LoadRegistryOptions = {}): LoadedRegistry {
  const path = resolveRegistryPath(options.path);

  if (path === "") {
    throw new RegistryError({
      code: "registry-missing",
      message: "no registry file was given, because the path is empty",
      fix: `Give a registry path, or check an example by running model-registry check --registry ${EXAMPLE_PATH}.`,
      path: "",
      problems: [],
    });
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new RegistryError({
        code: "registry-missing",
        message: `no registry file exists at "${path}"`,
        fix: `Create the file, or check an example by running model-registry check --registry ${EXAMPLE_PATH}.`,
        path,
        problems: [],
      });
    }
    throw new RegistryError({
      code: "registry-unreadable",
      message: `the registry file at "${path}" cannot be read`,
      fix: "Make the file a readable file, then run model-registry check again.",
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
      message: `the registry file at "${path}" is not valid JSON`,
      fix: "Fix the JSON syntax, then run model-registry check again.",
      path,
      problems: [],
    });
  }

  const { problems, index } = validateRegistry(parsed);
  if (problems.length > 0) {
    const first = problems[0];
    throw new RegistryError({
      code: aggregateCode(problems),
      message:
        first !== undefined && problems.length === 1
          ? first.message
          : `the registry file at "${path}" has ${problems.length} problems`,
      fix:
        first !== undefined && problems.length === 1
          ? first.fix
          : "Fix each problem listed in problems, then run model-registry check again.",
      path,
      problems,
    });
  }

  const digest: RegistryDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return {
    format: 1,
    digest,
    path,
    registry: index.registry,
    routes: index.routes,
    sections: index.sections,
  };
}
