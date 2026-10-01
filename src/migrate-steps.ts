import type { JsonValue } from "./types.js";

/** The current registry format major. Format 1 is the first major this package ships. */
export const CURRENT_FORMAT = 1 as const;

/** A parsed registry object with every property readonly, so a step cannot mutate its input. */
export type ReadonlyJsonObject = { readonly [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** A migration step maps a parsed registry from format N to format N + 1 and returns a new object. */
export type MigrateStep = (parsed: ReadonlyJsonObject) => JsonObject;

/** One table entry: the step that migrates a registry from format `from` to `from + 1`. */
export interface MigrateStepEntry {
  readonly from: number;
  readonly step: MigrateStep;
}

/** Empty until a format 2 release appends the step from format 1. */
export const MIGRATE_STEPS: readonly MigrateStepEntry[] = [];

/** True when this release's step table can migrate a registry that declares `format`. */
export function canMigrateFrom(format: number): boolean {
  return MIGRATE_STEPS.some((entry) => entry.from === format);
}
