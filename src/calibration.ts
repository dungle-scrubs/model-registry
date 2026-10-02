import { buildRouteLabel } from "./label.js";
import type {
  Benchmark,
  Calibration,
  Figure,
  Model,
  Override,
  RatingValue,
  RegistryProblem,
} from "./types.js";
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

/**
 * Score one figure against a benchmark's bands. With `direction: higher` a
 * figure at or above `at` takes `score`; with `lower`, at or below. The first
 * band that matches wins. A figure no band matches gives no score.
 */
export function scoreFigure(benchmark: Benchmark, figure: Figure): RatingValue | undefined {
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
 * table computes.
 */
function allowsValue(
  overrides: readonly Override[],
  rating: string,
  target: { model: string } | { route: string },
  written: RatingValue,
): boolean {
  return overrides.some((override) => {
    if (override.rating !== rating || override.value !== written) {
      return false;
    }
    return "model" in override
      ? "model" in target && override.model === target.model
      : !("model" in target) && override.route === target.route;
  });
}

/** The table's value for one rating of one subject, or undefined when absent. */
function computedRating(
  calibration: Calibration,
  subject: string,
  rating: string,
): RatingValue | undefined {
  const feed = ownedFeed(calibration, rating);
  if (feed === undefined) {
    return undefined;
  }
  const scores: RatingValue[] = [];
  for (const benchmarkName of feed) {
    const benchmark = ownedBenchmark(calibration, benchmarkName);
    if (benchmark === undefined) {
      // The reference check failed any feeds entry naming a benchmark the
      // file does not declare; the lookup must miss it, including a name
      // that hits an inherited property.
      continue;
    }
    const figure = ownedFigure(calibration, subject, benchmarkName);
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

/** The feed one rating owns. An inherited key such as toString is not a feed. */
function ownedFeed(calibration: Calibration, rating: string): readonly string[] | undefined {
  const feeds = calibration.feeds;
  if (feeds === undefined || !Object.hasOwn(feeds, rating)) {
    return undefined;
  }
  return feeds[rating];
}

/** One declared benchmark. An inherited key is not a benchmark. */
function ownedBenchmark(calibration: Calibration, name: string): Benchmark | undefined {
  const benchmarks = calibration.benchmarks;
  if (benchmarks === undefined || !Object.hasOwn(benchmarks, name)) {
    return undefined;
  }
  return benchmarks[name];
}

/** One figure a subject owns for one benchmark. Inherited keys are not figures. */
function ownedFigure(calibration: Calibration, subject: string, name: string): Figure | undefined {
  const figures = calibration.figures;
  if (figures === undefined || !Object.hasOwn(figures, subject)) {
    return undefined;
  }
  const byBenchmark = figures[subject];
  if (byBenchmark === undefined || !Object.hasOwn(byBenchmark, name)) {
    return undefined;
  }
  return byBenchmark[name];
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
  /** The models section as the schema validated it. */
  readonly models: Readonly<Record<string, Model>>;
  /** The calibration section as the schema validated it. */
  readonly calibration: Calibration;
}

/**
 * Compare every written rating with the table its own file stores. Only a
 * rating the file feeds is compared: its written value passes when the table
 * computes it, when an override allows exactly that value, or when handSet
 * names the rating; anything else is one rating-mismatch problem per written
 * value. A rating no feed claims is never compared.
 */
export function collectRatingMismatchProblems(input: RatingCheckInput): RegistryProblem[] {
  const { calibration, models } = input;
  const problems: RegistryProblem[] = [];

  const handSet = new Set(calibration.handSet ?? []);
  const overrides = calibration.overrides ?? [];

  // A rating in handSet MUST NOT appear in feeds: it would claim a computed
  // value the user wrote by hand.
  for (const [index, rating] of (calibration.handSet ?? []).entries()) {
    if (Object.hasOwn(calibration.feeds ?? {}, rating)) {
      problems.push(
        invalidProblem(
          childPath("$", "calibration", "handSet", index),
          `the rating "${rating}" appears in both handSet and feeds`,
          `Remove "${rating}" from calibration.handSet or from calibration.feeds; a hand-set rating has no computed value.`,
        ),
      );
    }
  }

  for (const [modelKey, model] of Object.entries(models)) {
    for (const [rating, written] of Object.entries(model.ratings ?? {})) {
      // Only ratings in feeds are checked; a rating the file does not feed
      // states no computed basis, so its written value is never compared.
      if (ownedFeed(calibration, rating) === undefined) {
        continue;
      }
      // handSet ratings are written by hand and need no table and no override.
      if (handSet.has(rating)) {
        continue;
      }
      const computed = computedRating(calibration, modelKey, rating);
      if (computed !== written && !allowsValue(overrides, rating, { model: modelKey }, written)) {
        problems.push(modelRatingMismatchProblem({ modelKey, rating, written, computed }));
      }
    }
  }

  // Route cost. handSet naming the reserved rating exempts every written
  // cost; otherwise each written cost must be computed or overridden, and the
  // cost is compared only when a feed claims it.
  if (ownedFeed(calibration, ROUTE_RATING_NAME) !== undefined && !handSet.has(ROUTE_RATING_NAME)) {
    for (const [modelKey, model] of Object.entries(models)) {
      model.routes.forEach((route, routeIndex) => {
        const written = route.cost;
        if (written === undefined) {
          return;
        }
        const label = buildRouteLabel(modelKey, route);
        const computed = computedRating(calibration, label, ROUTE_RATING_NAME);
        if (
          computed !== written &&
          !allowsValue(overrides, ROUTE_RATING_NAME, { route: label }, written)
        ) {
          problems.push(
            routeCostMismatchProblem({ label, written, computed, modelKey, routeIndex }),
          );
        }
      });
    }
  }

  return problems;
}
