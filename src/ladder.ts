/**
 * The format 1 effort ladder. The order is part of the format: a query can
 * ask for a level at least as high as X, and the only way to add a level is a
 * minor release. Keep `EFFORT_LADDER` as the single source of truth: the
 * schema enum mirrors it (a test asserts the two stay in lockstep) and
 * `EffortLevel` is derived from it.
 */
export const EFFORT_LADDER = ["low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_LADDER)[number];
