import { existsSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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

/** One table entry: the step that migrates a registry from format `from` to `from + 1`. */
export interface MigrateStepEntry {
  readonly from: number;
  readonly step: MigrateStep;
}

/**
 * The production migration table, keyed by the format each step migrates
 * from. Format 1 is the first major, so no entry here ships yet; the
 * release that introduces format N+1 appends its `{ from: N, step }` entry.
 */
export const MIGRATE_STEPS: readonly MigrateStepEntry[] = [];

function isPlainRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the value is a record whose format field is an integer. */
function hasIntegerFormat(value: unknown): value is JsonObject & { format: number } {
  if (!isPlainRecord(value)) {
    return false;
  }
  const format: unknown = value.format;
  return typeof format === "number" && Number.isInteger(format);
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
 * Apply the steps whose formats the parsed registry passes through, until
 * the format field reads `currentFormat`. Each entry hands its output to
 * the entry for the next format. Stops when the parsed object reaches the
 * target format or when the table has no entry for the current one.
 */
export function applyMigrateSteps(
  parsed: JsonObject,
  steps: readonly MigrateStepEntry[],
  currentFormat: number = CURRENT_FORMAT,
): JsonObject {
  let value: JsonObject = parsed;
  let format = declaredFormat(value);
  while (format < currentFormat) {
    const entry = steps.find((candidate) => candidate.from === format);
    if (entry === undefined) {
      return value;
    }
    value = entry.step(value);
    format = declaredFormat(value);
  }
  return value;
}

export interface MigrateOptions {
  path?: string;
  steps?: readonly MigrateStepEntry[];
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
  if (!hasIntegerFormat(value)) {
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
  const startFormat = value.format;
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

export function serializeMigrated(parsed: JsonObject): Buffer {
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}
