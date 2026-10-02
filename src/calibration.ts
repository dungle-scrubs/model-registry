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

/** Find the override that targets one rating on one model or route, if any. */
export function findOverride(
  overrides: readonly Override[],
  rating: string,
  target: { model: string } | { route: string },
): Override | undefined {
  return overrides.find((override) => {
    if (override.rating !== rating) {
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
  const feed = calibration.feeds?.[rating];
  if (feed === undefined) {
    return undefined;
  }
  const scores: RatingValue[] = [];
  for (const benchmarkName of feed) {
    // The reference check already failed any feeds entry naming an
    // undeclared benchmark, so the lookup always hits.
    const benchmark = calibration.benchmarks?.[benchmarkName] as Benchmark;
    const figure = calibration.figures?.[subject]?.[benchmarkName];
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

function overrideIndexOf(overrides: readonly Override[], override: Override): number {
  return overrides.indexOf(override);
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

function modelOverrideMismatchProblem(args: {
  modelKey: string;
  rating: string;
  written: RatingValue;
  overrides: readonly Override[];
  override: Override;
}): RegistryProblem {
  const { modelKey, rating, written, overrides, override } = args;
  const index = overrideIndexOf(overrides, override);
  const field = childPath("$", "models", modelKey, "ratings", rating);
  return {
    code: "rating-mismatch",
    field,
    fix: `Set the rating "${rating}" of model "${modelKey}" to ${override.value} (the override at calibration.overrides[${index}] allows it), or set that override's value to ${written}.`,
    message: `the written rating "${rating}" of model "${modelKey}" is ${written} but the override at calibration.overrides[${index}] gives ${override.value}`,
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

function routeOverrideMismatchProblem(args: {
  label: string;
  written: RatingValue;
  overrides: readonly Override[];
  override: Override;
  modelKey: string;
  routeIndex: number;
}): RegistryProblem {
  const { label, written, overrides, override, modelKey, routeIndex } = args;
  const index = overrideIndexOf(overrides, override);
  const field = childPath("$", "models", modelKey, "routes", routeIndex, "cost");
  return {
    code: "rating-mismatch",
    field,
    fix: `Set the cost of route "${label}" to ${override.value} (the override at calibration.overrides[${index}] allows it), or set that override's value to ${written}.`,
    message: `the written cost of route "${label}" is ${written} but the override at calibration.overrides[${index}] gives ${override.value}`,
  };
}

export interface RatingCheckInput {
  /** The models section as the schema validated it. */
  readonly models: Readonly<Record<string, Model>>;
  /** The calibration section as the schema validated it. */
  readonly calibration: Calibration;
}

/**
 * Compare every written rating with the table its own file stores. A written
 * value passes when the table computes it, when an override allows exactly
 * that value, or when handSet names the rating; anything else is one
 * rating-mismatch problem per written value.
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
      // handSet ratings are written by hand and need no table and no override.
      if (handSet.has(rating)) {
        continue;
      }
      const override = findOverride(overrides, rating, { model: modelKey });
      if (override !== undefined) {
        if (override.value !== written) {
          problems.push(
            modelOverrideMismatchProblem({ modelKey, rating, written, overrides, override }),
          );
        }
        continue;
      }
      const computed = computedRating(calibration, modelKey, rating);
      if (computed !== written) {
        problems.push(modelRatingMismatchProblem({ modelKey, rating, written, computed }));
      }
    }
  }

  // Route cost. handSet naming the reserved rating exempts every written
  // cost; otherwise each written cost must be computed or overridden.
  if (!handSet.has(ROUTE_RATING_NAME)) {
    for (const [modelKey, model] of Object.entries(models)) {
      model.routes.forEach((route, routeIndex) => {
        const written = route.cost;
        if (written === undefined) {
          return;
        }
        const label = buildRouteLabel(modelKey, route);
        const override = findOverride(overrides, ROUTE_RATING_NAME, { route: label });
        if (override !== undefined) {
          if (override.value !== written) {
            problems.push(
              routeOverrideMismatchProblem({
                label,
                written,
                overrides,
                override,
                modelKey,
                routeIndex,
              }),
            );
          }
          return;
        }
        const computed = computedRating(calibration, label, ROUTE_RATING_NAME);
        if (computed !== written) {
          problems.push(
            routeCostMismatchProblem({ label, written, computed, modelKey, routeIndex }),
          );
        }
      });
    }
  }

  return problems;
}
