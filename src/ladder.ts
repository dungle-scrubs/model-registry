/** Ordered lowest to highest; the order is part of format 1. */
export const EFFORT_LADDER = ["low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_LADDER)[number];
