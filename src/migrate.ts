import { chmodSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { RegistryError } from "./error.js";
import { checkParsedRegistry, readRegistryFile } from "./load-registry.js";
import {
  CURRENT_FORMAT,
  type JsonObject,
  MIGRATE_STEPS,
  type MigrateStepEntry,
  type ReadonlyJsonObject,
} from "./migrate-steps.js";
import type { JsonValue } from "./types.js";
import { isPlainObject } from "./validate.js";

export type {
  JsonObject,
  MigrateStep,
  MigrateStepEntry,
  ReadonlyJsonObject,
} from "./migrate-steps.js";
export { CURRENT_FORMAT, MIGRATE_STEPS } from "./migrate-steps.js";

/** The integer format a parsed registry declares, or undefined when it declares no usable one. */
function declaredFormat(parsed: unknown): number | undefined {
  if (!isPlainObject(parsed)) {
    return undefined;
  }
  const format = parsed.format;
  return typeof format === "number" && Number.isInteger(format) ? format : undefined;
}

/**
 * Apply the steps whose formats the parsed registry passes through, until
 * the format field reads `currentFormat`. Each entry hands its output to
 * the entry for the next format. Stops when the parsed object reaches the
 * target format or when the table has no entry for the current one.
 */
export function applyMigrateSteps(
  parsed: ReadonlyJsonObject,
  steps: readonly MigrateStepEntry[],
  currentFormat: number = CURRENT_FORMAT,
): JsonObject {
  let value: JsonObject = parsed;
  const startFormat = declaredFormat(value);
  if (startFormat === undefined) {
    throw new Error("the parsed registry declares no usable format");
  }
  let format = startFormat;
  while (format < currentFormat) {
    const entry = steps.find((candidate) => candidate.from === format);
    if (entry === undefined) {
      return value;
    }
    const next = entry.step(value);
    const nextFormat = declaredFormat(next);
    if (nextFormat !== format + 1) {
      const declared = nextFormat === undefined ? "no usable format" : `format ${nextFormat}`;
      throw new Error(
        `the migration step from format ${format} declared ${declared}, not format ${format + 1}`,
      );
    }
    value = next;
    format = nextFormat;
  }
  return value;
}

export interface MigrateOptions {
  readonly path?: string | undefined;
  readonly steps?: readonly MigrateStepEntry[] | undefined;
  readonly dryRun?: boolean | undefined;
}

export interface MigrateNothingToDo {
  readonly kind: "nothing-to-do";
  readonly format: typeof CURRENT_FORMAT;
  readonly path: string;
}

export interface MigrateDryRunResult {
  readonly kind: "dry-run";
  readonly format: typeof CURRENT_FORMAT;
  readonly path: string;
  readonly bytes: Buffer;
}

export interface MigrateAppliedResult {
  readonly kind: "applied";
  readonly format: typeof CURRENT_FORMAT;
  readonly path: string;
  readonly bytes: Buffer;
  readonly backupPath: string;
  readonly originalFormat: number;
}

export type MigrateResult = MigrateNothingToDo | MigrateDryRunResult | MigrateAppliedResult;

export type MigrateOutcome = MigrateResult | { kind: "error"; error: RegistryError };

export function runMigrate(options: MigrateOptions = {}): MigrateOutcome {
  const steps = options.steps ?? MIGRATE_STEPS;
  let read: ReturnType<typeof readRegistryFile>;
  try {
    read = readRegistryFile(options.path);
  } catch (error) {
    if (error instanceof RegistryError) {
      return { kind: "error", error };
    }
    throw error;
  }
  const { path, bytes } = read;
  const value: JsonValue = read.parsed;
  const declared = declaredFormat(value);
  if (declared === undefined || declared > CURRENT_FORMAT) {
    const checked = checkParsedRegistry(path, value, "migrate");
    if (checked.ok) {
      throw new Error(
        `validateRegistry accepted a registry at "${path}" whose declared format is unusable`,
      );
    }
    return { kind: "error", error: checked.error };
  }
  if (declared === CURRENT_FORMAT) {
    return { kind: "nothing-to-do", format: CURRENT_FORMAT, path };
  }

  // declaredFormat returned an integer, so the parsed value is a JSON object.
  const migrated = applyMigrateSteps(value as ReadonlyJsonObject, steps, CURRENT_FORMAT);
  const checked = checkParsedRegistry(path, migrated, "migrate");
  if (!checked.ok) {
    return { kind: "error", error: checked.error };
  }

  const serialized = serializeMigrated(migrated);

  if (options.dryRun === true) {
    return { kind: "dry-run", format: CURRENT_FORMAT, path, bytes: serialized };
  }

  const targetPath = realpathSync(path);
  const mode = statSync(targetPath).mode & 0o777;
  const backupPath = backupNameFor(targetPath, declared);
  try {
    writeFileSync(backupPath, bytes, { flag: "wx" });
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST") {
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
    throw error;
  }
  const tempPath = `${targetPath}.migrate-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, serialized);
    chmodSync(tempPath, mode);
    renameSync(tempPath, targetPath);
  } catch (error) {
    removeIfPresent(tempPath);
    throw error;
  }

  return {
    kind: "applied",
    format: CURRENT_FORMAT,
    path,
    bytes: serialized,
    backupPath,
    originalFormat: declared,
  };
}

function backupNameFor(path: string, originalFormat: number): string {
  return join(dirname(path), `${basename(path)}.format-${originalFormat}.bak`);
}

function removeIfPresent(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Best effort: the error that triggered the cleanup matters more.
  }
}

export function serializeMigrated(parsed: JsonObject): Buffer {
  return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}
