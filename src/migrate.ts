import { existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RegistryError } from "./error.js";
import { readRegistryFile, registryErrorForProblems } from "./load-registry.js";
import type { JsonValue } from "./types.js";
import { validateRegistry } from "./validate.js";

/** The current registry format major. Format 1 is the first major this package ships. */
export const CURRENT_FORMAT = 1 as const;

/**
 * A migration step maps a parsed registry from format N to format N+1.
 * Steps are pure: the input must not be mutated, the output must declare
 * `format: N + 1`, and the output must validate against the destination
 * format's slice of this loader.
 */
export type MigrateStep = (parsed: JsonObject) => JsonObject;

export type JsonObject = { [key: string]: JsonValue };

/**
 * The production migration table. Each entry moves one format major to the
 * next. Format 1 is the first major, so no entry here ships yet; a step
 * arrives alongside the format that needs it.
 */
export const MIGRATE_STEPS: readonly MigrateStep[] = [];

function isPlainRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The integer format a parsed registry declares, or NaN when it declares no usable one. */
function declaredFormat(parsed: unknown): number {
  if (!isPlainRecord(parsed)) {
    return Number.NaN;
  }
  const format = parsed.format;
  return typeof format === "number" && Number.isInteger(format) ? format : Number.NaN;
}

/**
 * Apply each step in order until the format field reads `currentFormat`.
 * Each step declares the format of its output, and the next step is fed
 * that output. Stops when the parsed object reaches the target format or
 * when the table runs out.
 */
export function applyMigrateSteps(
  parsed: unknown,
  steps: readonly MigrateStep[],
  currentFormat: number = CURRENT_FORMAT,
): JsonObject {
  let value: unknown = parsed;
  while (declaredFormat(value) < currentFormat) {
    const step = steps[declaredFormat(value)];
    if (step === undefined) {
      return value as JsonObject;
    }
    const next = step(value as JsonObject);
    value = next;
  }
  return value as JsonObject;
}

export interface MigrateOptions {
  path?: string;
  steps?: readonly MigrateStep[];
  dryRun?: boolean;
}

export interface MigrateNothingToDone {
  kind: "nothing-to-do";
  format: typeof CURRENT_FORMAT;
  path: string;
}

export interface MigrateDryRunResult {
  kind: "dry-run";
  format: typeof CURRENT_FORMAT;
  path: string;
  bytes: Buffer;
}

export interface MigrateAppliedResult {
  kind: "applied";
  format: typeof CURRENT_FORMAT;
  path: string;
  bytes: Buffer;
  backupPath: string;
  originalFormat: number;
}

export type MigrateResult = MigrateNothingToDone | MigrateDryRunResult | MigrateAppliedResult;

export type MigrateOutcome = MigrateResult | { kind: "error"; error: RegistryError };

function registryError(error: unknown): RegistryError | undefined {
  return error instanceof RegistryError ? error : undefined;
}

/**
 * The full migration flow shared by the CLI's `migrate` command and tests.
 * Reads the file with the same loader errors as `check`, applies the
 * step table, validates the migrated result, then either prints (dry
 * run) or writes a backup and replaces the file.
 */
export function runMigrate(options: MigrateOptions = {}): MigrateOutcome {
  const steps = options.steps ?? MIGRATE_STEPS;
  let read: ReturnType<typeof readRegistryFile>;
  try {
    read = readRegistryFile(options.path);
  } catch (error) {
    const registryErrorInstance = registryError(error);
    if (registryErrorInstance) {
      return { kind: "error", error: registryErrorInstance };
    }
    throw error;
  }
  const { path, bytes } = read;
  const value: unknown = read.parsed;
  const startFormat = declaredFormat(value);
  if (Number.isNaN(startFormat)) {
    // No usable format: report the same problem check reports for the
    // same file, built by the same shared mapping.
    const validation = validateRegistry(value);
    if (!validation.ok) {
      return {
        kind: "error",
        error: registryErrorForProblems(path, validation.problems, "migrate"),
      };
    }
    throw new Error(`validateRegistry accepted a registry with no usable format at "${path}"`);
  }
  if (startFormat > CURRENT_FORMAT) {
    return {
      kind: "error",
      error: new RegistryError({
        code: "format-unsupported",
        fix: `Upgrade model-registry to a release that supports format ${startFormat}.`,
        message: `format ${startFormat} is newer than the format ${CURRENT_FORMAT} this model-registry supports`,
        path,
        problems: [],
      }),
    };
  }
  if (startFormat === CURRENT_FORMAT) {
    return { kind: "nothing-to-do", format: CURRENT_FORMAT, path };
  }

  const migrated = applyMigrateSteps(value, steps, CURRENT_FORMAT);

  const migratedFormat = declaredFormat(migrated);
  if (migratedFormat !== CURRENT_FORMAT) {
    return {
      kind: "error",
      error: new RegistryError({
        code: "format-unsupported",
        fix: `Run model-registry migrate once a release ships the migration from format ${migratedFormat} to ${CURRENT_FORMAT}; no such step is available in this release.`,
        message: `format ${migratedFormat} is older than format ${CURRENT_FORMAT} with no step to upgrade it`,
        path,
        problems: [],
      }),
    };
  }

  const validation = validateRegistry(migrated);
  if (!validation.ok) {
    return { kind: "error", error: registryErrorForProblems(path, validation.problems, "migrate") };
  }

  const serialized = serializeMigrated(migrated);

  if (options.dryRun === true) {
    return { kind: "dry-run", format: CURRENT_FORMAT, path, bytes: serialized };
  }

  const backupPath = backupNameFor(path, startFormat);
  if (existsSync(backupPath)) {
    return {
      kind: "error",
      error: new RegistryError({
        code: "backup-exists",
        fix: `Move or rename the backup at "${backupPath}" so the next migrate can write its backup, then run model-registry migrate again.`,
        message: `a backup already exists at "${backupPath}"`,
        path,
        problems: [],
      }),
    };
  }

  writeFileSync(backupPath, bytes);
  const tempPath = `${path}.migrate-${process.pid}-${Date.now()}.tmp`;
  writeFileSync(tempPath, serialized);
  renameSync(tempPath, path);

  return {
    kind: "applied",
    format: CURRENT_FORMAT,
    path,
    bytes: serialized,
    backupPath,
    originalFormat: startFormat,
  };
}

function backupNameFor(path: string, originalFormat: number): string {
  return join(dirname(path), `${basename(path)}.format-${originalFormat}.bak`);
}

function basename(path: string): string {
  const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSeparator === -1 ? path : path.slice(lastSeparator + 1);
}

export function serializeMigrated(parsed: JsonObject): Buffer {
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}
