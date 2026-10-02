import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { RegistryError } from "../src/error.js";
import { loadRegistry } from "../src/load-registry.js";
import type { RegistryProblem } from "../src/types.js";
import { catchRegistryError, examplePath, repoRoot, withTempDir, writeJson } from "./helpers.js";

const exampleBytes = readFileSync(examplePath);

const indexA = {
  source: "https://example.org/a",
  field: "index",
  version: "4.3",
  direction: "higher",
  bands: [
    { at: 50, score: 9 },
    { at: 40, score: 8 },
    { at: 30, score: 7 },
  ],
};
const costPerTask = {
  source: "https://example.org/a",
  field: "costPerTask",
  version: "4.3",
  direction: "lower",
  bands: [
    { at: 0.5, score: 9 },
    { at: 1.0, score: 8 },
  ],
};

function figure(value: number): { value: number; read: string; effort: string } {
  return { value, read: "2026-09-30", effort: "high" };
}

const rfcCalibration = {
  benchmarks: { "index-a": indexA, "cost-per-task": costPerTask },
  feeds: { intelligence: ["index-a"], cost: ["cost-per-task"] },
  figures: {
    "model-a": { "index-a": figure(52.1) },
    "model-a@harness-y/provider-1": { "cost-per-task": figure(0.32) },
  },
};

/**
 * The registry the RFC's calibration example implies: model-a rates 9 by the
 * index-a table (52.1 lands in the 50 band) and its provider route costs 9 by
 * the cost-per-task table (0.32 lands in the 0.5 band).
 */
function rfcExampleRegistry(): Record<string, unknown> {
  return {
    format: 1,
    ratings: { intelligence: "Solves hard problems." },
    models: {
      "model-a": {
        family: "family-a",
        ratings: { intelligence: 9 },
        routes: [
          { harness: "harness-x", modelId: "model-id-a", hosted: false },
          {
            harness: "harness-y",
            modelId: "model-id-b",
            provider: "provider-1",
            hosted: true,
            cost: 9,
          },
        ],
      },
    },
    calibration: rfcCalibration,
  };
}

function withIntelligenceRegistry(
  calibration: Record<string, unknown>,
  written: number,
): Record<string, unknown> {
  return {
    format: 1,
    ratings: { intelligence: "Solves hard problems." },
    models: {
      "model-a": {
        family: "family-a",
        ratings: { intelligence: written },
        routes: [{ harness: "harness-x", modelId: "model-id-a", hosted: false }],
      },
    },
    calibration,
  };
}

function firstProblem(error: RegistryError): RegistryProblem {
  const problem = error.problems[0];
  if (problem === undefined) {
    throw new Error("expected at least one problem");
  }
  return problem;
}

describe("calibration shape", () => {
  test("the RFC calibration example validates, with higher and lower bands", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "rfc-example.json", rfcExampleRegistry());
      const loaded = loadRegistry({ path });
      expect(loaded.registry.calibration?.benchmarks?.["cost-per-task"]?.direction).toBe("lower");
      expect(loaded.registry.calibration?.benchmarks?.["index-a"]?.direction).toBe("higher");
    });
  });

  test("a boundary figure takes its band: at 50 scores 9, below every band scores nothing", async () => {
    await withTempDir(async (dir) => {
      const boundary = writeJson(
        dir,
        "boundary.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["index-a"] },
            figures: { "model-a": { "index-a": figure(50) } },
          },
          9,
        ),
      );
      expect(() => loadRegistry({ path: boundary })).not.toThrow();

      const below = writeJson(
        dir,
        "below.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["index-a"] },
            figures: { "model-a": { "index-a": figure(29.9) } },
          },
          9,
        ),
      );
      const error = catchRegistryError(() => loadRegistry({ path: below }));
      expect(error.code).toBe("rating-mismatch");
    });
  });

  test("the first matching band wins in both directions", async () => {
    await withTempDir(async (dir) => {
      const higherPath = writeJson(
        dir,
        "first-higher.json",
        withIntelligenceRegistry(
          {
            benchmarks: {
              "index-a": {
                ...indexA,
                bands: [
                  { at: 30, score: 7 },
                  { at: 50, score: 9 },
                ],
              },
            },
            feeds: { intelligence: ["index-a"] },
            figures: { "model-a": { "index-a": figure(60) } },
          },
          7,
        ),
      );
      expect(() => loadRegistry({ path: higherPath })).not.toThrow();

      const lowerBoundary = writeJson(
        dir,
        "lower-boundary.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "cost-per-task": costPerTask },
            feeds: { intelligence: ["cost-per-task"] },
            figures: { "model-a": { "cost-per-task": figure(0.5) } },
          },
          9,
        ),
      );
      expect(() => loadRegistry({ path: lowerBoundary })).not.toThrow();

      const lowerPath = writeJson(
        dir,
        "first-lower.json",
        withIntelligenceRegistry(
          {
            benchmarks: {
              "cost-per-task": {
                ...costPerTask,
                bands: [
                  { at: 1.0, score: 8 },
                  { at: 0.5, score: 9 },
                ],
              },
            },
            feeds: { intelligence: ["cost-per-task"] },
            figures: { "model-a": { "cost-per-task": figure(0.3) } },
          },
          8,
        ),
      );
      expect(() => loadRegistry({ path: lowerPath })).not.toThrow();
    });
  });

  test("an unknown calibration field fails with registry-invalid naming the field", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "unknown-field.json", {
        ...rfcExampleRegistry(),
        calibration: { ...rfcCalibration, surprise: true },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(
        error.problems.some(
          (problem) =>
            problem.field === '$["calibration"]["surprise"]' &&
            problem.message.includes("surprise"),
        ),
      ).toBe(true);
    });
  });

  test("a direction other than higher or lower fails with registry-invalid", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "wrong-direction.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          benchmarks: { "index-a": { ...indexA, direction: "sideways" } },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      const problem = error.problems.find(
        (candidate) => candidate.field === '$["calibration"]["benchmarks"]["index-a"]["direction"]',
      );
      expect(problem).toBeDefined();
      expect(problem?.message).toContain('the benchmark direction must be "higher" or "lower"');
      expect(problem?.fix).toContain('Set "direction" to "higher" or "lower".');
    });
  });

  test("notes is allowed on the section and on each benchmark", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "notes.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          notes: "placeholder history",
          benchmarks: {
            "index-a": { ...indexA, notes: "placeholder benchmark note" },
            "cost-per-task": costPerTask,
          },
        },
      });
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("an override must name exactly one of model or route with a non-empty reason", async () => {
    await withTempDir(async (dir) => {
      const both = writeJson(dir, "both.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          overrides: [
            {
              rating: "intelligence",
              model: "model-a",
              route: "model-a@harness-x",
              value: 9,
              reason: "both",
            },
          ],
        },
      });
      expect(catchRegistryError(() => loadRegistry({ path: both })).code).toBe("registry-invalid");

      const neither = writeJson(dir, "neither.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          overrides: [{ rating: "intelligence", value: 9, reason: "neither" }],
        },
      });
      expect(catchRegistryError(() => loadRegistry({ path: neither })).code).toBe(
        "registry-invalid",
      );

      const emptyReason = writeJson(dir, "empty-reason.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          overrides: [{ rating: "intelligence", model: "model-a", value: 9, reason: "" }],
        },
      });
      expect(catchRegistryError(() => loadRegistry({ path: emptyReason })).code).toBe(
        "registry-invalid",
      );
    });
  });

  test("every calibration shape fault reports a curated problem at its field", async () => {
    type MutableCalibration = {
      benchmarks: Record<string, unknown>;
      feeds: Record<string, unknown>;
      figures: Record<string, unknown>;
      handSet: unknown[];
      overrides: unknown[];
    };
    const cases: Array<{
      name: string;
      fault: (calibration: MutableCalibration) => void;
      field: string;
      message: string;
      fix: string;
    }> = [
      {
        name: "calibration is not an object",
        fault: () => undefined,
        field: '$["calibration"]',
        message: "the calibration section must be a JSON object",
        fix: "Replace calibration with a JSON object.",
      },
      {
        name: "benchmark is not an object",
        fault: (c) => {
          c.benchmarks = { "index-a": "not-an-object" };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]',
        message: 'the benchmark "index-a" must be a JSON object',
        fix: "Replace the benchmark with a JSON object.",
      },
      {
        name: "benchmark misses source",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          delete b.source;
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["source"]',
        message: 'the benchmark is missing the required field "source"',
        fix: 'Add a "source" string naming the upstream.',
      },
      {
        name: "benchmark field is not a string",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          b.version = 43;
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["version"]',
        message: 'the benchmark field "version" must be a string',
        fix: 'Set "version" to a string.',
      },
      {
        name: "benchmark bands is not an array",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          b.bands = "none";
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["bands"]',
        message: "the benchmark bands field must be a non-empty array",
        fix: "Set bands to a non-empty array of {at, score} objects.",
      },
      {
        name: "benchmark notes is not a string",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          b.notes = 7;
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["notes"]',
        message: 'the benchmark field "notes" must be a string',
        fix: 'Set "notes" to a string, or remove it.',
      },
      {
        name: "band is not an object",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          b.bands = ["not-an-object"];
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["bands"][0]',
        message: "a band must be a JSON object",
        fix: "Replace the band with a JSON object.",
      },
      {
        name: "band misses at",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          b.bands = [{ score: 9 }];
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["bands"][0]["at"]',
        message: 'the band is missing the required field "at"',
        fix: 'Add an "at" number for the figure value at this band.',
      },
      {
        name: "band score is out of range",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          b.bands = [{ at: 50, score: 11 }];
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["bands"][0]["score"]',
        message: 'the band field "score" must be an integer from 1 to 10',
        fix: 'Set "score" to an integer from 1 to 10.',
      },
      {
        name: "feeds entry is not an array",
        fault: (c) => {
          c.feeds = { intelligence: "index-a" };
        },
        field: '$["calibration"]["feeds"]["intelligence"]',
        message: 'the calibration feeds entry for "intelligence" must be a non-empty array',
        fix: "Set the feeds entry to a non-empty array of benchmark names declared in calibration.benchmarks.",
      },
      {
        name: "feeds entry item is not a string",
        fault: (c) => {
          c.feeds = { intelligence: [5] };
        },
        field: '$["calibration"]["feeds"]["intelligence"][0]',
        message: "a feeds benchmark entry must be a string",
        fix: "Set the entry to a benchmark name declared in calibration.benchmarks.",
      },
      {
        name: "figures subject is not an object",
        fault: (c) => {
          c.figures = { "model-a": "not-an-object" };
        },
        field: '$["calibration"]["figures"]["model-a"]',
        message: 'the figures entry for "model-a" must be a JSON object',
        fix: "Replace the figures entry with a JSON object keyed by benchmark name.",
      },
      {
        name: "figure is not an object",
        fault: (c) => {
          c.figures = { "model-a": { "index-a": "not-an-object" } };
        },
        field: '$["calibration"]["figures"]["model-a"]["index-a"]',
        message: 'the figure for "index-a" on "model-a" must be a JSON object',
        fix: "Replace the figure with a JSON object with value, read and effort.",
      },
      {
        name: "figure misses value",
        fault: (c) => {
          c.figures = { "model-a": { "index-a": { read: "2026-09-30", effort: "high" } } };
        },
        field: '$["calibration"]["figures"]["model-a"]["index-a"]["value"]',
        message: 'the figure is missing the required field "value"',
        fix: 'Add a "value" number for the figure.',
      },
      {
        name: "handSet entry is not a string",
        fault: (c) => {
          c.handSet = [5];
        },
        field: '$["calibration"]["handSet"][0]',
        message: "a handSet entry must be a string",
        fix: "Set the entry to a rating name.",
      },
      {
        name: "override entry is not an object",
        fault: (c) => {
          c.overrides = ["not-an-object"];
        },
        field: '$["calibration"]["overrides"][0]',
        message: "an override entry must be a JSON object",
        fix: "Replace the override with a JSON object.",
      },
      {
        name: "override misses reason",
        fault: (c) => {
          c.overrides = [{ rating: "cost", route: "model-a@harness-y/provider-1", value: 9 }];
        },
        field: '$["calibration"]["overrides"][0]["reason"]',
        message: 'the override is missing the required field "reason"',
        fix: 'Add a non-empty "reason" string.',
      },
      {
        name: "override route is not a string",
        fault: (c) => {
          c.overrides = [{ rating: "cost", route: 5, value: 9, reason: "x" }];
        },
        field: '$["calibration"]["overrides"][0]["route"]',
        message: 'the override field "route" must be a string',
        fix: 'Set "route" to a string.',
      },
      {
        name: "benchmark misses direction",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          delete b.direction;
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["direction"]',
        message: 'the benchmark is missing the required field "direction"',
        fix: 'Add a "direction" of "higher" or "lower".',
      },
      {
        name: "benchmark misses bands",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          delete b.bands;
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["bands"]',
        message: 'the benchmark is missing the required field "bands"',
        fix: "Add a bands array with at least one band.",
      },
      {
        name: "band misses score",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          b.bands = [{ at: 50 }];
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["bands"][0]["score"]',
        message: 'the band is missing the required field "score"',
        fix: 'Add a "score" integer from 1 to 10.',
      },
      {
        name: "band at is not a number",
        fault: (c) => {
          const b = { ...(c.benchmarks["index-a"] as Record<string, unknown>) };
          b.bands = [{ at: "50", score: 9 }];
          c.benchmarks = { "index-a": b };
        },
        field: '$["calibration"]["benchmarks"]["index-a"]["bands"][0]["at"]',
        message: 'the band field "at" must be a number',
        fix: 'Set "at" to a finite number.',
      },
      {
        name: "figure misses read",
        fault: (c) => {
          c.figures = { "model-a": { "index-a": { value: 52.1, effort: "high" } } };
        },
        field: '$["calibration"]["figures"]["model-a"]["index-a"]["read"]',
        message: 'the figure is missing the required field "read"',
        fix: 'Add a "read" string naming the date read.',
      },
      {
        name: "override reason is empty",
        fault: (c) => {
          c.overrides = [
            { rating: "cost", route: "model-a@harness-y/provider-1", value: 9, reason: "" },
          ];
        },
        field: '$["calibration"]["overrides"][0]["reason"]',
        message: 'the override field "reason" must be a non-empty string',
        fix: 'Set "reason" to a non-empty string.',
      },
      {
        name: "override misses rating",
        fault: (c) => {
          c.overrides = [{ route: "model-a@harness-y/provider-1", value: 9, reason: "x" }];
        },
        field: '$["calibration"]["overrides"][0]["rating"]',
        message: 'the override is missing the required field "rating"',
        fix: 'Add a "rating" string naming the rating to override.',
      },
      {
        name: "override rating is not a string",
        fault: (c) => {
          c.overrides = [
            { rating: 5, route: "model-a@harness-y/provider-1", value: 9, reason: "x" },
          ];
        },
        field: '$["calibration"]["overrides"][0]["rating"]',
        message: 'the override field "rating" must be a string',
        fix: 'Set "rating" to a string.',
      },
      {
        name: "override value is not an integer in range",
        fault: (c) => {
          c.overrides = [
            { rating: "cost", route: "model-a@harness-y/provider-1", value: "9", reason: "x" },
          ];
        },
        field: '$["calibration"]["overrides"][0]["value"]',
        message: 'the override field "value" must be an integer from 1 to 10',
        fix: 'Set "value" to an integer from 1 to 10.',
      },
    ];
    await withTempDir(async (dir) => {
      for (const [index, testCase] of cases.entries()) {
        const calibration =
          testCase.name === "calibration is not an object"
            ? "not-an-object"
            : structuredClone(rfcCalibration);
        if (typeof calibration !== "string") {
          testCase.fault(calibration as unknown as MutableCalibration);
        }
        const path = writeJson(dir, `fault-${index}.json`, {
          ...rfcExampleRegistry(),
          calibration,
        });
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe("registry-invalid");
        const problem = error.problems.find((candidate) => candidate.field === testCase.field);
        expect(problem, `${testCase.name}: field ${testCase.field}`).toBeDefined();
        expect(problem?.message, testCase.name).toContain(testCase.message);
        expect(problem?.fix, testCase.name).toContain(testCase.fix);
      }
    });
  });

  test("shape faults outside calibration keep their curated problems", async () => {
    const cases: Array<{
      name: string;
      registry: Record<string, unknown>;
      field: string;
      message: string;
      fix: string;
    }> = [
      {
        name: "route hosted is not a boolean",
        registry: {
          ...rfcExampleRegistry(),
          models: {
            "model-a": {
              family: "family-a",
              routes: [{ harness: "harness-x", modelId: "model-id-a", hosted: "yes" }],
            },
          },
        },
        field: '$["models"]["model-a"]["routes"][0]["hosted"]',
        message: 'the field "hosted" must be a boolean',
        fix: 'Set "hosted" to true or false.',
      },
      {
        name: "route cost is not an integer in range",
        registry: {
          ...rfcExampleRegistry(),
          models: {
            "model-a": {
              family: "family-a",
              routes: [{ harness: "harness-x", modelId: "model-id-a", hosted: true, cost: "9" }],
            },
          },
        },
        field: '$["models"]["model-a"]["routes"][0]["cost"]',
        message: 'the field "cost" must be an integer from 1 to 10',
        fix: 'Set "cost" to an integer from 1 (expensive) to 10 (cheap).',
      },
      {
        name: "model maxEffort is off the ladder",
        registry: {
          ...rfcExampleRegistry(),
          models: {
            "model-a": {
              family: "family-a",
              maxEffort: "turbo",
              routes: [],
            },
          },
        },
        field: '$["models"]["model-a"]["maxEffort"]',
        message: 'the field "maxEffort" must be one of low, medium, high, xhigh, max',
        fix: 'Set "maxEffort" to one of low, medium, high, xhigh, max.',
      },
      {
        name: "meter spendToZero is not the literal true",
        registry: {
          ...rfcExampleRegistry(),
          meters: { "plan-a": { spendToZero: false } },
        },
        field: '$["meters"]["plan-a"]["spendToZero"]',
        message: "accepts only the literal true",
        fix: 'Set "spendToZero" to true, or remove it.',
      },
      {
        name: "meter notes is not a string",
        registry: {
          ...rfcExampleRegistry(),
          meters: { "plan-a": { notes: 5 } },
        },
        field: '$["meters"]["plan-a"]["notes"]',
        message: 'field "notes" must be a string',
        fix: 'Set the meter "plan-a" notes to a string, or remove it.',
      },
    ];
    await withTempDir(async (dir) => {
      for (const [index, testCase] of cases.entries()) {
        const path = writeJson(dir, `base-fault-${index}.json`, testCase.registry);
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe("registry-invalid");
        const problem = error.problems.find((candidate) => candidate.field === testCase.field);
        expect(problem, `${testCase.name}: field ${testCase.field}`).toBeDefined();
        expect(problem?.message, testCase.name).toContain(testCase.message);
        expect(problem?.fix, testCase.name).toContain(testCase.fix);
      }
    });
  });

  test("a file with problems of two codes reports the aggregate registry-invalid", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "mixed-codes.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          surprise: true,
          feeds: { intelligence: ["unknown-bench"], cost: ["cost-per-task"] },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(error.problems.some((problem) => problem.code === "reference-unknown")).toBe(true);
      expect(error.problems.some((problem) => problem.code === "registry-invalid")).toBe(true);
    });
  });
});

describe("calibration references", () => {
  test("a feeds benchmark name that benchmarks does not declare fails with reference-unknown", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "unknown-benchmark.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          feeds: { intelligence: ["unknown-bench"] },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("reference-unknown");
      expect(
        error.problems.some(
          (problem) =>
            problem.code === "reference-unknown" &&
            problem.field === '$["calibration"]["feeds"]["intelligence"][0]' &&
            problem.message.includes('"unknown-bench"'),
        ),
      ).toBe(true);
    });
  });

  test("a feeds rating name that ratings does not declare fails with reference-unknown", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "unrated-feed.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          feeds: { intelligence: ["index-a"], wisdom: ["index-a"] },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("reference-unknown");
      expect(
        error.problems.some(
          (problem) =>
            problem.field === '$["calibration"]["feeds"]["wisdom"]' &&
            problem.message.includes('"wisdom"'),
        ),
      ).toBe(true);
    });
  });

  test("a handSet rating name that ratings does not declare fails with reference-unknown", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "unrated-handset.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          handSet: ["taste"],
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("reference-unknown");
      expect(
        error.problems.some(
          (problem) =>
            problem.field === '$["calibration"]["handSet"][0]' &&
            problem.message.includes('"taste"'),
        ),
      ).toBe(true);
    });
  });

  test("an override naming an undeclared rating, model or route fails with reference-unknown", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "override-references.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          overrides: [
            { rating: "taste", model: "model-a", value: 9, reason: "unknown rating" },
            { rating: "intelligence", model: "model-z", value: 9, reason: "unknown model" },
            { rating: "cost", route: "model-a@harness-z", value: 9, reason: "unknown route" },
          ],
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("reference-unknown");
      const fields = error.problems.map((problem) => problem.field);
      expect(fields).toContain('$["calibration"]["overrides"][0]["rating"]');
      expect(fields).toContain('$["calibration"]["overrides"][1]["model"]');
      expect(fields).toContain('$["calibration"]["overrides"][2]["route"]');
    });
  });

  test("an override for a declared route label is a valid reference", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "override-route.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          overrides: [
            {
              rating: "cost",
              route: "model-a@harness-y/provider-1",
              value: 9,
              reason: "subscription",
            },
          ],
        },
      });
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });
});

describe("calibration rating check", () => {
  test("a written rating the table scores differently fails with rating-mismatch and a fix naming the computed value and the override", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(
        dir,
        "mismatch.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["index-a"] },
            figures: { "model-a": { "index-a": figure(42) } },
          },
          7,
        ),
      );
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("rating-mismatch");
      const problem = firstProblem(error);
      expect(problem.field).toBe('$["models"]["model-a"]["ratings"]["intelligence"]');
      expect(problem.message).toBe(
        'the written rating "intelligence" of model "model-a" is 7 but the table gives 8',
      );
      expect(problem.fix).toContain("to 8 (the table gives 8)");
      expect(problem.fix).toContain("calibration.overrides");
      expect(problem.fix).toContain('rating "intelligence"');
      expect(problem.fix).toContain('model "model-a"');
      expect(problem.fix).toContain("value 7");
    });
  });

  test("a written rating no band scores fails with rating-mismatch saying the table gives no value", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(
        dir,
        "no-value.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["index-a"] },
            figures: { "model-a": { "index-a": figure(20) } },
          },
          7,
        ),
      );
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("rating-mismatch");
      const problem = firstProblem(error);
      expect(problem.message).toBe(
        'the written rating "intelligence" of model "model-a" is 7 but the table gives no value for it',
      );
      expect(problem.fix).toContain("The table gives no value");
      expect(problem.fix).toContain("remove the rating");
      expect(problem.fix).toContain("value 7");
    });
  });

  test("a written rating the file never feeds is not checked", async () => {
    await withTempDir(async (dir) => {
      // The figure would score 8 against the written 9, but no feed claims
      // to compute the rating, so nothing is compared.
      const path = writeJson(
        dir,
        "unfed.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            figures: { "model-a": { "index-a": figure(42) } },
          },
          9,
        ),
      );
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("a calibration with no feeds checks nothing", async () => {
    await withTempDir(async (dir) => {
      // Every written value disagrees with what the figures would score,
      // but the calibration states no feed at all.
      const path = writeJson(dir, "no-feeds.json", {
        ...rfcExampleRegistry(),
        calibration: {
          benchmarks: { "index-a": indexA, "cost-per-task": costPerTask },
          figures: {
            "model-a": { "index-a": figure(42) },
            "model-a@harness-y/provider-1": { "cost-per-task": figure(0.8) },
          },
        },
      });
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("a handSet rating is never compared with a table", async () => {
    await withTempDir(async (dir) => {
      // intelligence is fed and agrees, so the rating check demonstrably
      // runs on this file; the hand-set taste is never compared, although
      // a figure exists whose table would score it.
      const path = writeJson(dir, "handset.json", {
        format: 1,
        ratings: { intelligence: "Solves hard problems.", taste: "Subjective fit." },
        models: {
          "model-a": {
            family: "family-a",
            ratings: { intelligence: 9, taste: 4 },
            routes: [{ harness: "harness-x", modelId: "model-id-a", hosted: false }],
          },
        },
        calibration: {
          benchmarks: {
            "index-a": indexA,
            "taste-bench": {
              source: "https://example.org/t",
              field: "taste",
              version: "1.0",
              direction: "higher",
              bands: [{ at: 0, score: 1 }],
            },
          },
          feeds: { intelligence: ["index-a"] },
          handSet: ["taste"],
          figures: {
            "model-a": { "index-a": figure(52.1), "taste-bench": figure(1) },
          },
        },
      });
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("an override allows the written rating it names, even against the table", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(
        dir,
        "override-allows.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["index-a"] },
            figures: { "model-a": { "index-a": figure(52.1) } },
            overrides: [
              {
                rating: "intelligence",
                model: "model-a",
                value: 7,
                reason: "row at a higher effort",
              },
            ],
          },
          7,
        ),
      );
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("an override whose value differs never fails a value the table computes", async () => {
    await withTempDir(async (dir) => {
      // The table computes 9 and the written rating is 9; a stale override
      // naming 6 must not reject the file.
      const path = writeJson(
        dir,
        "override-stale-table-correct.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["index-a"] },
            figures: { "model-a": { "index-a": figure(52.1) } },
            overrides: [
              { rating: "intelligence", model: "model-a", value: 6, reason: "stale override" },
            ],
          },
          9,
        ),
      );
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("a written value no table result and no override allows fails naming the computed value", async () => {
    await withTempDir(async (dir) => {
      // The table computes 9, the written rating is 7 and the only override
      // names 6: the fix must offer the computed 9 and an override for 7.
      const path = writeJson(
        dir,
        "override-mismatch.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["index-a"] },
            figures: { "model-a": { "index-a": figure(52.1) } },
            overrides: [
              { rating: "intelligence", model: "model-a", value: 6, reason: "stale override" },
            ],
          },
          7,
        ),
      );
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("rating-mismatch");
      const problem = firstProblem(error);
      expect(problem.field).toBe('$["models"]["model-a"]["ratings"]["intelligence"]');
      expect(problem.message).toBe(
        'the written rating "intelligence" of model "model-a" is 7 but the table gives 9',
      );
      expect(problem.fix).toContain("to 9 (the table gives 9)");
      expect(problem.fix).toContain("value 7");
    });
  });

  test("any duplicate override that matches the written value allows it, in any order", async () => {
    await withTempDir(async (dir) => {
      const calibration = (first: number, second: number) => ({
        benchmarks: { "index-a": indexA },
        feeds: { intelligence: ["index-a"] },
        figures: { "model-a": { "index-a": figure(52.1) } },
        overrides: [
          { rating: "intelligence", model: "model-a", value: first, reason: "first" },
          { rating: "intelligence", model: "model-a", value: second, reason: "second" },
        ],
      });
      const matchingLast = writeJson(
        dir,
        "matching-last.json",
        withIntelligenceRegistry(calibration(6, 7), 7),
      );
      expect(() => loadRegistry({ path: matchingLast })).not.toThrow();

      const matchingFirst = writeJson(
        dir,
        "matching-first.json",
        withIntelligenceRegistry(calibration(7, 6), 7),
      );
      expect(() => loadRegistry({ path: matchingFirst })).not.toThrow();
    });
  });

  test("a rating fed by several benchmarks is the floor of the mean of their scores", async () => {
    await withTempDir(async (dir) => {
      const calibration = {
        benchmarks: {
          "index-a": indexA,
          "index-b": {
            source: "https://example.org/b",
            field: "index",
            version: "1.0",
            direction: "higher",
            bands: [{ at: 45, score: 8 }],
          },
        },
        feeds: { intelligence: ["index-a", "index-b"] },
        figures: {
          "model-a": { "index-a": figure(52.1), "index-b": figure(46) },
        },
      };
      // mean(9, 8) = 8.5, floor 8.
      const agrees = writeJson(dir, "floor-agrees.json", withIntelligenceRegistry(calibration, 8));
      expect(() => loadRegistry({ path: agrees })).not.toThrow();

      const disagrees = writeJson(
        dir,
        "floor-disagrees.json",
        withIntelligenceRegistry(calibration, 9),
      );
      const error = catchRegistryError(() => loadRegistry({ path: disagrees }));
      expect(error.code).toBe("rating-mismatch");
      expect(firstProblem(error).message).toContain("but the table gives 8");
    });
  });

  test("a missing figure is skipped; the rating falls back to the remaining benchmark", async () => {
    await withTempDir(async (dir) => {
      const calibration = {
        benchmarks: {
          "index-a": indexA,
          "index-b": {
            source: "https://example.org/b",
            field: "index",
            version: "1.0",
            direction: "higher",
            bands: [{ at: 45, score: 8 }],
          },
        },
        feeds: { intelligence: ["index-a", "index-b"] },
        figures: { "model-a": { "index-a": figure(52.1) } },
      };
      // index-b has no figure; mean(9) = 9.
      const path = writeJson(dir, "missing-figure.json", withIntelligenceRegistry(calibration, 9));
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("a written cost the table scores differently fails with rating-mismatch at the route's cost field", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "cost-mismatch.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          figures: {
            "model-a": { "index-a": figure(52.1) },
            "model-a@harness-y/provider-1": { "cost-per-task": figure(0.8) },
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("rating-mismatch");
      const problem = firstProblem(error);
      expect(problem.field).toBe('$["models"]["model-a"]["routes"][1]["cost"]');
      expect(problem.message).toBe(
        'the written cost of route "model-a@harness-y/provider-1" is 9 but the table gives 8',
      );
      expect(problem.fix).toContain("to 8 (the table gives 8)");
      expect(problem.fix).toContain('route "model-a@harness-y/provider-1"');
      expect(problem.fix).toContain('rating "cost"');
      expect(problem.fix).toContain("value 9");
    });
  });

  test("a written cost with no figure fails unless an override carries it", async () => {
    await withTempDir(async (dir) => {
      const withoutCostFigure = {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          figures: { "model-a": { "index-a": figure(52.1) } },
        },
      };
      const failing = writeJson(dir, "cost-no-figure.json", withoutCostFigure);
      const error = catchRegistryError(() => loadRegistry({ path: failing }));
      expect(error.code).toBe("rating-mismatch");
      const noValueProblem = firstProblem(error);
      expect(noValueProblem.message).toContain("the table gives no value for it");
      expect(noValueProblem.fix).toContain("The table gives no value for the cost");
      expect(noValueProblem.fix).toContain("remove the cost");

      const carried = writeJson(dir, "cost-override.json", {
        ...withoutCostFigure,
        calibration: {
          ...withoutCostFigure.calibration,
          overrides: [
            {
              rating: "cost",
              route: "model-a@harness-y/provider-1",
              value: 9,
              reason: "subscription, no per-task price",
            },
          ],
        },
      });
      expect(() => loadRegistry({ path: carried })).not.toThrow();
    });
  });

  test("a cost override whose value differs never fails a cost the table computes", async () => {
    await withTempDir(async (dir) => {
      // The table computes 9 and the written cost is 9; a stale override
      // naming 6 must not reject the file.
      const path = writeJson(dir, "cost-override-stale.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          overrides: [
            {
              rating: "cost",
              route: "model-a@harness-y/provider-1",
              value: 6,
              reason: "stale override",
            },
          ],
        },
      });
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("a route that writes no cost is never a mismatch, even when the table could compute one", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "cost-absent.json", {
        format: 1,
        ratings: { intelligence: "Solves hard problems." },
        models: {
          "model-a": {
            family: "family-a",
            ratings: { intelligence: 9 },
            routes: [
              { harness: "harness-x", modelId: "model-id-a", hosted: false },
              {
                harness: "harness-y",
                modelId: "model-id-b",
                provider: "provider-1",
                hosted: true,
                // no cost written although a figure exists below
              },
            ],
          },
        },
        calibration: {
          benchmarks: { "index-a": indexA, "cost-per-task": costPerTask },
          feeds: { intelligence: ["index-a"], cost: ["cost-per-task"] },
          figures: {
            "model-a": { "index-a": figure(52.1) },
            "model-a@harness-y/provider-1": { "cost-per-task": figure(0.32) },
          },
        },
      });
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("a written route cost is checked only when cost is in feeds", async () => {
    await withTempDir(async (dir) => {
      // The cost figure scores 8 against the written 9.
      const calibration = {
        benchmarks: { "index-a": indexA, "cost-per-task": costPerTask },
        feeds: { intelligence: ["index-a"] },
        figures: {
          "model-a": { "index-a": figure(52.1) },
          "model-a@harness-y/provider-1": { "cost-per-task": figure(0.8) },
        },
      };
      const unfed = writeJson(dir, "cost-unfed.json", {
        ...rfcExampleRegistry(),
        calibration,
      });
      expect(() => loadRegistry({ path: unfed })).not.toThrow();

      const fed = writeJson(dir, "cost-fed.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...calibration,
          feeds: { intelligence: ["index-a"], cost: ["cost-per-task"] },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path: fed }));
      expect(error.code).toBe("rating-mismatch");
      expect(firstProblem(error).field).toBe('$["models"]["model-a"]["routes"][1]["cost"]');
    });
  });

  test("handSet naming the reserved cost exempts written route costs from the check", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "handset-cost.json", {
        ...rfcExampleRegistry(),
        calibration: {
          benchmarks: { "index-a": indexA },
          feeds: { intelligence: ["index-a"] },
          handSet: ["cost"],
          figures: { "model-a": { "index-a": figure(52.1) } },
        },
      });
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("a rating in both handSet and feeds fails", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(
        dir,
        "handset-in-feeds.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["index-a"] },
            handSet: ["intelligence"],
            figures: { "model-a": { "index-a": figure(52.1) } },
          },
          9,
        ),
      );
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      const problem = firstProblem(error);
      expect(problem.field).toBe('$["calibration"]["handSet"][0]');
      expect(problem.message).toBe('the rating "intelligence" appears in both handSet and feeds');
    });
  });

  test("cost in both handSet and feeds fails the same way", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "handset-cost-fed.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          handSet: ["cost"],
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(
        error.problems.some(
          (problem) =>
            problem.field === '$["calibration"]["handSet"][0]' &&
            problem.message.includes("both handSet and feeds"),
        ),
      ).toBe(true);
    });
  });

  test("a rating named toString with empty feeds does not throw", async () => {
    await withTempDir(async (dir) => {
      // An inherited property such as Object.prototype.toString must not read
      // as a feed: the rating is unfed and never compared.
      const path = writeJson(dir, "prototype-feed.json", {
        format: 1,
        ratings: { toString: "Subjective fit." },
        models: {
          "model-a": {
            family: "family-a",
            ratings: { toString: 9 },
            routes: [{ harness: "harness-x", modelId: "model-id-a", hosted: false }],
          },
        },
        calibration: {
          benchmarks: { "index-a": indexA },
          feeds: {},
          figures: { "model-a": { "index-a": figure(42) } },
        },
      });
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("a feeds entry naming an inherited property does not throw", async () => {
    await withTempDir(async (dir) => {
      // The benchmark lookup must miss an inherited key rather than score
      // against it; the entry is also an unknown benchmark reference.
      const path = writeJson(
        dir,
        "prototype-benchmark.json",
        withIntelligenceRegistry(
          {
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["toString"] },
            figures: { "model-a": { "index-a": figure(52.1) } },
          },
          9,
        ),
      );
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("reference-unknown");
    });
  });

  test("a file with other problems reports them without the rating check on top", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(
        dir,
        "shape-first.json",
        withIntelligenceRegistry(
          {
            surprise: true,
            benchmarks: { "index-a": indexA },
            feeds: { intelligence: ["index-a"] },
            figures: { "model-a": { "index-a": figure(42) } },
          },
          7,
        ),
      );
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(error.problems.every((problem) => problem.code === "registry-invalid")).toBe(true);
    });
  });
});

describe("calibration figures for undeclared subjects", () => {
  test("figures naming an undeclared model or route are skipped by the rating check", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "ghost-figures.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          figures: {
            "model-a": { "index-a": figure(52.1) },
            "model-a@harness-y/provider-1": { "cost-per-task": figure(0.32) },
            "model-z": { "index-a": figure(20) },
            "ghost@harness-x": { "cost-per-task": figure(99) },
          },
        },
      });
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("figures for an undeclared subject are still shape-checked", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "ghost-shape.json", {
        ...rfcExampleRegistry(),
        calibration: {
          ...rfcCalibration,
          figures: {
            "model-z": { "index-a": { value: "52.1", read: "2026-09-30", effort: "high" } },
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(
        error.problems.some((problem) =>
          problem.field.startsWith('$["calibration"]["figures"]["model-z"]'),
        ),
      ).toBe(true);
    });
  });
});

describe("the example registry's calibration", () => {
  test("the example registry loads and its registry result carries calibration after meters", () => {
    const loaded = loadRegistry({ path: examplePath });
    expect(Object.keys(loaded.registry)).toEqual([
      "models",
      "ratings",
      "capabilities",
      "meters",
      "calibration",
    ]);
    expect(loaded.registry.calibration).toBeDefined();
    expect("calibration" in loaded.sections).toBe(false);
  });

  test("the example's placeholder table carries exactly one override and one handSet rating", () => {
    const example = JSON.parse(exampleBytes.toString("utf8")) as {
      calibration: { handSet: string[]; overrides: unknown[] };
    };
    expect(example.calibration.handSet).toHaveLength(1);
    expect(example.calibration.overrides).toHaveLength(1);
    expect(example.calibration.handSet[0]).not.toBe("cost");
  });

  test("every written rating in the example agrees with its table, its override or handSet", async () => {
    // An independent oracle: recompute every written value from the example's
    // own bands and figures, without going through the loader's check.
    const example = JSON.parse(exampleBytes.toString("utf8")) as {
      calibration: {
        benchmarks: Record<string, { direction: string; bands: { at: number; score: number }[] }>;
        feeds: Record<string, string[]>;
        figures: Record<string, Record<string, { value: number }>>;
        handSet: string[];
        overrides: { rating: string; model?: string; route?: string; value: number }[];
      };
      models: Record<
        string,
        {
          ratings?: Record<string, number>;
          routes: { harness: string; provider?: string; cost?: number }[];
        }
      >;
    };
    const { benchmarks, feeds, figures, handSet, overrides } = example.calibration;
    const score = (benchmarkName: string, subject: string): number | undefined => {
      const benchmark = benchmarks[benchmarkName];
      const figureValue = figures[subject]?.[benchmarkName]?.value;
      if (benchmark === undefined || figureValue === undefined) {
        return undefined;
      }
      for (const band of benchmark.bands) {
        if (benchmark.direction === "higher" ? figureValue >= band.at : figureValue <= band.at) {
          return band.score;
        }
      }
      return undefined;
    };
    const compute = (rating: string, subject: string): number | undefined => {
      const scores = (feeds[rating] ?? [])
        .map((benchmarkName) => score(benchmarkName, subject))
        .filter((value): value is number => value !== undefined);
      if (scores.length === 0) {
        return undefined;
      }
      return Math.floor(scores.reduce((a, b) => a + b, 0) / scores.length);
    };
    const allowsWritten = (
      rating: string,
      model: string,
      route: string | undefined,
      written: number,
    ) =>
      overrides.some(
        (entry) =>
          entry.rating === rating &&
          (route !== undefined ? entry.route === route : entry.model === model) &&
          entry.value === written,
      );

    for (const [modelKey, model] of Object.entries(example.models)) {
      for (const [rating, written] of Object.entries(model.ratings ?? {})) {
        if (handSet.includes(rating)) {
          continue;
        }
        // The written value must be what the table computes, or what any
        // override for that rating and target carries.
        const computed = compute(rating, modelKey);
        expect(
          computed === written || allowsWritten(rating, modelKey, undefined, written),
          `${modelKey} rating ${rating}`,
        ).toBe(true);
      }
      for (const route of model.routes) {
        if (route.cost === undefined) {
          continue;
        }
        const label = `${modelKey}@${route.harness}${route.provider ? `/${route.provider}` : ""}`;
        const computed = compute("cost", label);
        expect(
          computed === route.cost || allowsWritten("cost", modelKey, label, route.cost),
          `route ${label}`,
        ).toBe(true);
      }
    }

    // The same file must also pass the loader's own rating check.
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "example-copy.json", example);
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });
});

describe("the rating prompt", () => {
  test("ships in the package, names Artificial Analysis, and ends with model-registry check", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      files: string[];
    };
    expect(packageJson.files).toContain("prompts");

    const prompt = readFileSync(join(repoRoot, "prompts", "rating.md"), "utf8");
    expect(prompt).toContain("Artificial Analysis");
    const blocks = prompt.match(/```sh\n([\s\S]*?)```/g) ?? [];
    const lastBlock = blocks.at(-1);
    expect(lastBlock?.trim()).toBe("```sh\nmodel-registry check\n```");
    // The five steps of the RFC's rating method.
    for (const step of ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]) {
      expect(prompt).toContain(step);
    }
    // The package ships no default bands.
    expect(prompt).toContain("no default bands");
  });
});
