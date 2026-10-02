import { buildRouteLabel } from "./label.js";
import type { Band, BandDirection, RatingValue, RegistryProblem } from "./types.js";
import { ROUTE_RATING_NAME } from "./types.js";

function childPath(parent: string, ...parts: Array<string | number>): string {
  let path = parent;
  for (const part of parts) {
    path += typeof part === "number" ? `[${part}]` : `[${JSON.stringify(part)}]`;
  }
  return path;
}

function invalidProblem(field: string, message: string, fix: string): RegistryProblem {
  return { code: "registry-invalid", field, fix, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRatingValue(value: unknown): value is RatingValue {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

/** A benchmark whose bands and direction are readable; malformed parts are absent. */
interface ReadableBenchmark {
  readonly bands: readonly Band[];
  readonly direction: BandDirection;
}

/**
 * Score one figure against a benchmark's bands. With `direction: higher` a
 * figure at or above `at` takes `score`; with `lower`, at or below. The first
 * band that matches wins. A figure no band matches gives no score.
 */
export function scoreFigure(
  benchmark: ReadableBenchmark,
  figure: { readonly value: number },
): RatingValue | undefined {
  for (const band of benchmark.bands) {
    if (benchmark.direction === "higher" ? figure.value >= band.at : figure.value <= band.at) {
      return band.score;
    }
  }
  return undefined;
}

/**
 * Combine the scores of the benchmarks that produced one: the floor of their
 * mean. No score at all means the table gives no value for the rating.
 */
export function combineScores(scores: readonly RatingValue[]): RatingValue | undefined {
  if (scores.length === 0) {
    return undefined;
  }
  let total = 0;
  for (const score of scores) {
    total += score;
  }
  return Math.floor(total / scores.length) as RatingValue;
}

/**
 * Whether any override for one rating on one model or route carries exactly
 * the written value. Any matching override allows it: duplicates have no
 * order rule, and an override whose value differs never fails a value the
 * table computes. A malformed override entry matches nothing.
 */
function allowsValue(
  overrides: readonly unknown[],
  rating: string,
  target: { model: string } | { route: string },
  written: RatingValue,
): boolean {
  return overrides.some((candidate) => {
    if (!isPlainObject(candidate)) {
      return false;
    }
    if (candidate.rating !== rating || candidate.value !== written) {
      return false;
    }
    if (typeof candidate.model === "string") {
      return "model" in target && candidate.model === target.model;
    }
    if (typeof candidate.route === "string") {
      return !("model" in target) && candidate.route === target.route;
    }
    return false;
  });
}

/** The benchmark names a rating is fed by, or undefined when nothing feeds it. */
function readableFeed(
  feeds: Record<string, unknown> | undefined,
  rating: string,
): readonly unknown[] | undefined {
  if (feeds === undefined || !Object.hasOwn(feeds, rating)) {
    return undefined;
  }
  const feed = feeds[rating];
  return Array.isArray(feed) ? feed : undefined;
}

/** One benchmark the file declares, readable for scoring, or undefined. */
function readableBenchmark(
  calibration: Record<string, unknown>,
  name: string,
): ReadableBenchmark | undefined {
  const benchmarks = calibration.benchmarks;
  if (!isPlainObject(benchmarks) || !Object.hasOwn(benchmarks, name)) {
    return undefined;
  }
  const entry = benchmarks[name];
  if (!isPlainObject(entry)) {
    return undefined;
  }
  if (entry.direction !== "higher" && entry.direction !== "lower") {
    return undefined;
  }
  if (!Array.isArray(entry.bands)) {
    return undefined;
  }
  return { direction: entry.direction, bands: entry.bands.filter(isReadableBand) };
}

function isReadableBand(band: unknown): band is Band {
  return (
    isPlainObject(band) &&
    typeof band.at === "number" &&
    Number.isFinite(band.at) &&
    isRatingValue(band.score)
  );
}

/** One figure a subject owns for one benchmark, with a readable value. */
function readableFigure(
  calibration: Record<string, unknown>,
  subject: string,
  name: string,
): { readonly value: number } | undefined {
  const figures = calibration.figures;
  if (!isPlainObject(figures) || !Object.hasOwn(figures, subject)) {
    return undefined;
  }
  const byBenchmark = figures[subject];
  if (!isPlainObject(byBenchmark) || !Object.hasOwn(byBenchmark, name)) {
    return undefined;
  }
  const entry = byBenchmark[name];
  if (!isPlainObject(entry) || typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
    return undefined;
  }
  return { value: entry.value };
}

/** The table's value for one subject from one feed, or undefined when absent. */
function computeFromFeed(
  calibration: Record<string, unknown>,
  subject: string,
  feed: readonly unknown[],
): RatingValue | undefined {
  const scores: RatingValue[] = [];
  for (const benchmarkName of feed) {
    if (typeof benchmarkName !== "string") {
      continue;
    }
    const benchmark = readableBenchmark(calibration, benchmarkName);
    if (benchmark === undefined) {
      // The reference check failed any feeds entry the file does not declare,
      // and the lookup must miss an inherited key; the benchmark gives no score.
      continue;
    }
    const figure = readableFigure(calibration, subject, benchmarkName);
    if (figure === undefined) {
      continue;
    }
    const score = scoreFigure(benchmark, figure);
    if (score !== undefined) {
      scores.push(score);
    }
  }
  return combineScores(scores);
}

function tableText(computed: RatingValue | undefined): string {
  return computed === undefined ? "the table gives no value for it" : `the table gives ${computed}`;
}

function modelRatingMismatchProblem(args: {
  modelKey: string;
  rating: string;
  written: RatingValue;
  computed: RatingValue | undefined;
}): RegistryProblem {
  const { modelKey, rating, written, computed } = args;
  const field = childPath("$", "models", modelKey, "ratings", rating);
  const overrideHint = `add an entry to calibration.overrides with rating "${rating}", model "${modelKey}", value ${written} and a non-empty reason`;
  return {
    code: "rating-mismatch",
    field,
    fix:
      computed === undefined
        ? `The table gives no value for the rating "${rating}" of model "${modelKey}"; remove the rating, or ${overrideHint}.`
        : `Set the rating "${rating}" of model "${modelKey}" to ${computed} (the table gives ${computed}), or ${overrideHint}.`,
    message: `the written rating "${rating}" of model "${modelKey}" is ${written} but ${tableText(computed)}`,
  };
}

function routeCostMismatchProblem(args: {
  label: string;
  written: RatingValue;
  computed: RatingValue | undefined;
  modelKey: string;
  routeIndex: number;
}): RegistryProblem {
  const { label, written, computed, modelKey, routeIndex } = args;
  const field = childPath("$", "models", modelKey, "routes", routeIndex, "cost");
  const overrideHint = `add an entry to calibration.overrides with rating "${ROUTE_RATING_NAME}", route "${label}", value ${written} and a non-empty reason`;
  return {
    code: "rating-mismatch",
    field,
    fix:
      computed === undefined
        ? `The table gives no value for the cost of route "${label}"; remove the cost, or ${overrideHint}.`
        : `Set the cost of route "${label}" to ${computed} (the table gives ${computed}), or ${overrideHint}.`,
    message: `the written cost of route "${label}" is ${written} but ${tableText(computed)}`,
  };
}

export interface RatingCheckInput {
  /** The models section as the file states it; malformed parts are skipped. */
  readonly models: unknown;
  /** The calibration section as the file states it; malformed parts are skipped. */
  readonly calibration: unknown;
}

/**
 * Compare every written rating with the table its own file stores. Only a
 * rating the file feeds is compared: its written value passes when the table
 * computes it or when an override carries exactly that value, and handSet
 * names ratings that are never compared; anything else is one rating-mismatch
 * problem per written value. Each part guards locally, so the check runs
 * beside unrelated problems and a malformed band, figure or override skips
 * only what depends on it.
 */
export function collectRatingMismatchProblems(input: RatingCheckInput): RegistryProblem[] {
  const { calibration, models } = input;
  const problems: RegistryProblem[] = [];
  if (!isPlainObject(calibration)) {
    return problems;
  }

  const feeds = isPlainObject(calibration.feeds) ? calibration.feeds : undefined;
  const overrides = Array.isArray(calibration.overrides) ? calibration.overrides : [];

  // A rating in handSet MUST NOT appear in feeds: it would claim a computed
  // value the user wrote by hand.
  if (Array.isArray(calibration.handSet)) {
    calibration.handSet.forEach((rating, index) => {
      if (typeof rating !== "string" || feeds === undefined || !Object.hasOwn(feeds, rating)) {
        return;
      }
      problems.push(
        invalidProblem(
          childPath("$", "calibration", "handSet", index),
          `the rating "${rating}" appears in both handSet and feeds`,
          `Remove "${rating}" from calibration.handSet or from calibration.feeds; a hand-set rating has no computed value.`,
        ),
      );
    });
  }
  const handSet = new Set(
    Array.isArray(calibration.handSet)
      ? calibration.handSet.filter((rating): rating is string => typeof rating === "string")
      : [],
  );

  if (!isPlainObject(models)) {
    return problems;
  }
  const costFeed = readableFeed(feeds, ROUTE_RATING_NAME);
  for (const [modelKey, modelValue] of Object.entries(models)) {
    if (!isPlainObject(modelValue)) {
      continue;
    }
    if (isPlainObject(modelValue.ratings)) {
      for (const [rating, written] of Object.entries(modelValue.ratings)) {
        // Only ratings in feeds are checked; a rating the file does not feed
        // states no computed basis, so its written value is never compared.
        const feed = readableFeed(feeds, rating);
        if (feed === undefined || !isRatingValue(written)) {
          continue;
        }
        // The reserved cost feed targets route costs by label; a model
        // rating of the same name is never fed by it.
        if (rating === ROUTE_RATING_NAME) {
          continue;
        }
        // handSet ratings are written by hand and need no table and no override.
        if (handSet.has(rating)) {
          continue;
        }
        const computed = computeFromFeed(calibration, modelKey, feed);
        if (computed !== written && !allowsValue(overrides, rating, { model: modelKey }, written)) {
          problems.push(modelRatingMismatchProblem({ modelKey, rating, written, computed }));
        }
      }
    }
    // Route cost. handSet naming the reserved rating exempts every written
    // cost; otherwise each written cost on a fed cost rating must be computed
    // or overridden.
    if (costFeed === undefined || handSet.has(ROUTE_RATING_NAME)) {
      continue;
    }
    if (!Array.isArray(modelValue.routes)) {
      continue;
    }
    modelValue.routes.forEach((routeValue, routeIndex) => {
      if (!isPlainObject(routeValue) || !isRatingValue(routeValue.cost)) {
        return;
      }
      if (typeof routeValue.harness !== "string") {
        return;
      }
      if (Object.hasOwn(routeValue, "provider") && typeof routeValue.provider !== "string") {
        return;
      }
      const harness = { harness: routeValue.harness } as const;
      const label =
        typeof routeValue.provider === "string"
          ? buildRouteLabel(modelKey, { ...harness, provider: routeValue.provider })
          : buildRouteLabel(modelKey, harness);
      const computed = computeFromFeed(calibration, label, costFeed);
      if (
        computed !== routeValue.cost &&
        !allowsValue(overrides, ROUTE_RATING_NAME, { route: label }, routeValue.cost)
      ) {
        problems.push(
          routeCostMismatchProblem({
            label,
            written: routeValue.cost,
            computed,
            modelKey,
            routeIndex,
          }),
        );
      }
    });
  }

  return problems;
}
