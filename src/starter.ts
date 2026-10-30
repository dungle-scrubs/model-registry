import { buildRouteLabel } from "./label.js";
import type { RegistryFile } from "./types.js";

/** The model key the starter registry uses for its one example model. */
export const STARTER_MODEL_KEY = "example-model";

/** The model id the starter registry gives that model on every route. */
export const STARTER_MODEL_ID = "example-model-id";

/**
 * The smallest registry that shows every section a user fills in: two
 * ratings, one capability, one model with a route per chosen harness, the
 * router's rank, one task with its floors, and a profile that lists every
 * route label.
 *
 * The result passes the package's own validator and `model-router check`:
 * the model carries the ratings the task's floors ask for, so the declared
 * profile covers the task at every stakes level.
 */
export function starterRegistry(harnesses: readonly string[]): RegistryFile {
  const routes = harnesses.map((harness) => ({
    harness,
    hosted: true,
    modelId: STARTER_MODEL_ID,
  }));
  const labels = harnesses.map((harness) => buildRouteLabel(STARTER_MODEL_KEY, { harness }));
  return {
    format: 1,
    ratings: {
      coding: "Writes and changes code to a spec.",
      intelligence: "Reasons well and solves hard problems.",
    },
    capabilities: {
      "repo-access": "Reads and writes the repository.",
    },
    models: {
      [STARTER_MODEL_KEY]: {
        family: "example",
        ratings: { coding: 7, intelligence: 6 },
        routes,
      },
    },
    router: {
      rank: ["coding", "intelligence"],
    },
    tasks: {
      implement: {
        description: "Implement a change the user has specified.",
        minimums: {
          low: { coding: 5 },
          normal: { coding: 6 },
          high: { coding: 7 },
        },
        rank: ["coding", "intelligence"],
      },
    },
    profiles: {
      default: {
        description: "Every route in the registry.",
        routes: labels,
      },
    },
  };
}
