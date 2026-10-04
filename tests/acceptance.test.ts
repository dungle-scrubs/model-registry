import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, expectTypeOf, test } from "vitest";
import { RegistryError } from "../src/error.js";
import { EFFORT_LADDER } from "../src/ladder.js";
import { loadRegistry } from "../src/load-registry.js";
import { resolveRegistryPath } from "../src/path.js";
import type { Model, RegistryProblem, Route } from "../src/types.js";
import { AJV_OPTIONS } from "../src/validate.js";
import {
  catchRegistryError,
  createXdgConfigHome,
  deferredProperties,
  examplePath,
  repoRoot,
  runBuiltCli,
  sha256Hex,
  supportedProperties,
  withEnv,
  withTempDir,
  writeJson,
} from "./helpers.js";

const exampleBytes = readFileSync(examplePath);

describe("acceptance", () => {
  test("DW1 minimal example check", () => {
    const result = runBuiltCli(["check", "--registry", "examples/registry.json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["digest", "format", "path"]);
    expect(parsed.format).toBe(1);
    expect(parsed.digest).toBe(`sha256:${sha256Hex(exampleBytes)}`);
    expect(parsed.path).toBe(resolve(repoRoot, "examples", "registry.json"));
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  test("DW2 an explicit path beats MODEL_REGISTRY_FILE and XDG", async () => {
    await withTempDir(async (dir) => {
      const explicit = writeJson(dir, "explicit.json", {
        format: 1,
        models: { "model-explicit": { family: "family-a", routes: [] } },
      });
      const environment = writeJson(dir, "environment.json", {
        format: 1,
        models: { "model-environment": { family: "family-a", routes: [] } },
      });
      const xdg = createXdgConfigHome(dir, {
        format: 1,
        models: { "model-xdg": { family: "family-a", routes: [] } },
      });
      await withEnv({ MODEL_REGISTRY_FILE: environment, XDG_CONFIG_HOME: xdg }, () => {
        const loaded = loadRegistry({ path: explicit });
        expect(loaded.digest).toBe(`sha256:${sha256Hex(readFileSync(explicit))}`);
      });
    });
  });

  test("DW2 MODEL_REGISTRY_FILE beats XDG", async () => {
    await withTempDir(async (dir) => {
      const environment = writeJson(dir, "environment.json", {
        format: 1,
        models: { "model-environment": { family: "family-a", routes: [] } },
      });
      const xdg = createXdgConfigHome(dir, {
        format: 1,
        models: { "model-xdg": { family: "family-a", routes: [] } },
      });
      await withEnv({ MODEL_REGISTRY_FILE: environment, XDG_CONFIG_HOME: xdg }, () => {
        const loaded = loadRegistry();
        expect(loaded.digest).toBe(`sha256:${sha256Hex(readFileSync(environment))}`);
      });
    });
  });

  test("DW2 XDG applies without an explicit or environment path", async () => {
    await withTempDir(async (dir) => {
      const xdg = createXdgConfigHome(dir, {
        format: 1,
        models: { "model-xdg": { family: "family-a", routes: [] } },
      });
      await withEnv({ MODEL_REGISTRY_FILE: undefined, XDG_CONFIG_HOME: xdg }, () => {
        const loaded = loadRegistry();
        expect(loaded.digest).toBe(
          `sha256:${sha256Hex(readFileSync(join(xdg, "model-registry", "registry.json")))}`,
        );
      });
    });
  });

  test("DW2 unset XDG uses <home>/.config/model-registry/registry.json", async () => {
    await withTempDir(async (dir) => {
      const home = join(dir, "home");
      expect(resolveRegistryPath(undefined, {}, home)).toBe(
        join(home, ".config", "model-registry", "registry.json"),
      );
    });
  });

  test("DW3 missing file never falls back", async () => {
    await withTempDir(async (dir) => {
      const missing = join(dir, "nope.json");
      const error = catchRegistryError(() => loadRegistry({ path: missing }));
      expect(error).toBeInstanceOf(RegistryError);
      expect(error.code).toBe("registry-missing");
      expect(error.message).toContain(missing);
      expect(error.fix).toContain("examples/registry.json");
      expect(error.path).toBe(missing);

      const result = runBuiltCli(["check", "--registry", missing]);
      expect(result.exitCode).toBe(4);
      expect(result.stdout).toBe("");
      const envelope = JSON.parse(result.stderr) as { error: { code: string } };
      expect(envelope.error.code).toBe("registry-missing");
    });
  });

  test("DW4 collects two independent faults", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "two-faults.json", {
        format: 1,
        models: {
          "model-a": {
            family: "family-a",
            surprise: true,
            routes: [{ harness: "harness-x", modelId: "model-id-a" }],
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(error.problems).toHaveLength(2);
      const fields = error.problems.map((problem) => problem.field);
      expect(fields).toContain('$["models"]["model-a"]["surprise"]');
      expect(fields).toContain('$["models"]["model-a"]["routes"][0]["hosted"]');
      for (const problem of error.problems) {
        expect(problem.code).toBe("registry-invalid");
        expect(typeof problem.message).toBe("string");
        expect(problem.message.length).toBeGreaterThan(0);
        expect(typeof problem.fix).toBe("string");
        expect(problem.fix.length).toBeGreaterThan(0);
      }
    });
  });

  test("DW5 rejects invalid facts and duplicate labels", async () => {
    await withTempDir(async (dir) => {
      const validModel = {
        family: "family-a",
        routes: [
          { harness: "harness-x", modelId: "model-id-a", hosted: false },
          { harness: "harness-y", modelId: "model-id-b", provider: "provider-1", hosted: true },
        ],
      };
      const cases: Array<{ name: string; data: unknown; code: string }> = [
        {
          name: "route notes null",
          data: {
            format: 1,
            models: {
              "model-a": {
                ...validModel,
                routes: [
                  { harness: "harness-x", modelId: "model-id-a", hosted: false, notes: null },
                ],
              },
            },
          },
          code: "registry-invalid",
        },
        {
          name: "nested null in a foreign section",
          data: { format: 1, models: { "model-a": validModel }, router: { keys: ["a", null] } },
          code: "registry-invalid",
        },
        {
          name: "unknown model field",
          data: { format: 1, models: { "model-a": { ...validModel, extra: "x" } } },
          code: "registry-invalid",
        },
        {
          name: "unknown route field",
          data: {
            format: 1,
            models: {
              "model-a": {
                ...validModel,
                routes: [
                  { harness: "harness-x", modelId: "model-id-a", hosted: false, extra: "x" },
                ],
              },
            },
          },
          code: "registry-invalid",
        },
        {
          name: "missing hosted",
          data: {
            format: 1,
            models: {
              "model-a": {
                family: "family-a",
                routes: [{ harness: "harness-x", modelId: "model-id-a" }],
              },
            },
          },
          code: "registry-invalid",
        },
        {
          name: "duplicate first route",
          data: {
            format: 1,
            models: {
              "model-a": { ...validModel, routes: [validModel.routes[0], validModel.routes[0]] },
            },
          },
          code: "label-duplicate",
        },
      ];

      for (const testCase of cases) {
        const path = writeJson(dir, `${testCase.name.replace(/\W+/g, "-")}.json`, testCase.data);
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe(testCase.code);
        expect(error.problems.length, testCase.name).toBeGreaterThanOrEqual(1);
      }
    });
  });

  test("DW6 preserves foreign sections and indexes routes", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "foreign.json", {
        format: 1,
        models: {
          "model-a": {
            family: "family-a",
            routes: [
              { harness: "harness-x", modelId: "model-id-a", hosted: false },
              {
                harness: "harness-y",
                modelId: "model-id-b",
                provider: "provider-1",
                hosted: true,
              },
            ],
          },
        },
        router: { unrecognisedRouterField: ["placeholder", { enabled: true }] },
        "extension-a": { values: [1, false, "placeholder"] },
      });
      const loaded = loadRegistry({ path });
      expect(loaded.sections).toEqual({
        router: { unrecognisedRouterField: ["placeholder", { enabled: true }] },
        "extension-a": { values: [1, false, "placeholder"] },
      });
      expect(Object.keys(loaded.routes)).toEqual([
        "model-a@harness-x",
        "model-a@harness-y/provider-1",
      ]);
      expect(loaded.routes["model-a@harness-x"]).toEqual({
        model: "model-a",
        harness: "harness-x",
        modelId: "model-id-a",
        hosted: false,
      });
      expect(loaded.routes["model-a@harness-y/provider-1"]).toEqual({
        model: "model-a",
        harness: "harness-y",
        modelId: "model-id-b",
        provider: "provider-1",
        hosted: true,
      });
      expect(Object.hasOwn(loaded.routes["model-a@harness-x"] ?? {}, "provider")).toBe(false);
      expect(Object.hasOwn(loaded.routes["model-a@harness-x"] ?? {}, "privacyEligible")).toBe(
        false,
      );
    });
  });

  test("DW7 usage errors use stderr and exit two", () => {
    const cases = [
      { args: ["nope"], label: "unknown command" },
      { args: ["check", "--bogus"], label: "unknown flag" },
    ];
    for (const testCase of cases) {
      const result = runBuiltCli(testCase.args, { MODEL_REGISTRY_FILE: examplePath });
      expect(result.exitCode, testCase.label).toBe(2);
      expect(result.stdout, testCase.label).toBe("");
      expect(result.stderr, testCase.label).not.toContain("Usage:");
      expect(result.stderr, testCase.label).not.toMatch(/\n {4}at /);
      const lines = result.stderr.split("\n").filter((line) => line !== "");
      expect(lines, testCase.label).toHaveLength(1);
      const envelope = JSON.parse(lines[0] ?? "") as { error: { code: string } };
      expect(envelope.error.code, testCase.label).toBe("usage-invalid");
    }
  });

  test("DW8 schema and types agree", async () => {
    const schema = JSON.parse(readFileSync(join(repoRoot, "registry.schema.json"), "utf8"));
    const validate = new Ajv2020(AJV_OPTIONS).compile(schema);

    expect(validate(JSON.parse(exampleBytes.toString("utf8")))).toBe(true);

    const fullRoute: Route = {
      harness: "harness-x",
      modelId: "model-id-a",
      provider: "provider-1",
      hosted: true,
      privacyEligible: true,
      cost: 7,
      rateLimitRpm: 12.5,
      responseSeconds: 0.4,
      notes: "placeholder",
    };
    const fullModel: Model = { family: "family-a", notes: "placeholder", routes: [fullRoute] };
    const fullRegistry = { format: 1, models: { "model-a": fullModel } };
    expect(validate(fullRegistry)).toBe(true);

    const modelKeys = ["family", "fixedEffort", "maxEffort", "notes", "ratings", "routes"] as const;
    expectTypeOf<(typeof modelKeys)[number]>().toEqualTypeOf<keyof Model>();
    const routeKeys = [
      "capabilities",
      "cost",
      "harness",
      "hosted",
      "meter",
      "modelId",
      "notes",
      "privacyEligible",
      "provider",
      "rateLimitRpm",
      "responseSeconds",
    ] as const;
    expectTypeOf<(typeof routeKeys)[number]>().toEqualTypeOf<keyof Route>();

    expect(supportedProperties(schema.$defs.model.properties)).toEqual([...modelKeys].sort());
    expect(deferredProperties(schema.$defs.model.properties)).toEqual([]);
    expect(supportedProperties(schema.$defs.route.properties)).toEqual([...routeKeys].sort());
    expect(deferredProperties(schema.$defs.route.properties)).toEqual([]);
    expect(supportedProperties(schema.properties)).toEqual([
      "calibration",
      "capabilities",
      "format",
      "meters",
      "models",
      "profiles",
      "ratings",
    ]);
    expect(deferredProperties(schema.properties)).toEqual([]);

    const negatives: unknown[] = [
      {
        format: 1,
        models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, hosted: "yes" }] } },
      },
      {
        format: 1,
        models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, hosted: null }] } },
      },
      { format: 1, models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, extra: 1 }] } } },
      { format: 1, models: { "model-a": { ...fullModel, family: 5 } } },
      { format: 1, models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, cost: 11 }] } } },
      { format: 1, models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, cost: 0 }] } } },
      {
        format: 1,
        models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, rateLimitRpm: "5" }] } },
      },
      {
        format: 1,
        models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, rateLimitRpm: -1 }] } },
      },
      {
        format: 1,
        models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, responseSeconds: -0.5 }] } },
      },
      { format: 1, models: { "model-a": { family: "family-a" } } },
      { format: 1, models: { "model-a": { ...fullModel, notes: null } } },
      { format: 1 },
      { format: "1", models: {} },
      { models: {} },
      [1, 2],
      { format: 1, models: { "model-a": { ...fullModel, ratings: { coding: 11 } } } },
      { format: 1, models: { "model-a": { ...fullModel, ratings: { coding: 1.5 } } } },
      { format: 1, models: { "model-a": { ...fullModel, maxEffort: "off-the-ladder" } } },
      { format: 1, models: { "model-a": { ...fullModel, fixedEffort: "off-the-ladder" } } },
      { format: 1, models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, meter: 5 }] } } },
      {
        format: 1,
        models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, capabilities: [1] }] } },
      },
    ];
    for (const negative of negatives) {
      expect(validate(negative), JSON.stringify(negative)).toBe(false);
    }
  });

  test("DW9 undeclared rating, capability or meter fails with reference-unknown naming the field", async () => {
    await withTempDir(async (dir) => {
      const ratingProblem: RegistryProblem = {
        code: "reference-unknown",
        field: '$["models"]["model-a"]["ratings"]["coding"]',
        fix: 'Add "coding" to the ratings section, or remove the rating from the model.',
        message: 'the rating "coding" is not declared in the ratings section',
      };
      const capabilityProblem: RegistryProblem = {
        code: "reference-unknown",
        field: '$["models"]["model-a"]["routes"][0]["capabilities"][0]',
        fix: 'Add "browser" to the capabilities section, or remove the capability from the route.',
        message: 'the capability "browser" is not declared in the capabilities section',
      };
      const meterProblem: RegistryProblem = {
        code: "reference-unknown",
        field: '$["models"]["model-a"]["routes"][0]["meter"]',
        fix: 'Add "plan-a" to the meters section, or remove the meter from the route.',
        message: 'the meter "plan-a" is not declared in the meters section',
      };
      const cases: Array<{ name: string; data: unknown; problem: RegistryProblem }> = [
        {
          name: "rating without a top-level ratings section",
          data: {
            format: 1,
            models: {
              "model-a": { family: "family-a", ratings: { coding: 7 }, routes: [] },
            },
          },
          problem: ratingProblem,
        },
        {
          name: "rating not in the declared ratings",
          data: {
            format: 1,
            ratings: { taste: "Subjective." },
            models: {
              "model-a": { family: "family-a", ratings: { coding: 7 }, routes: [] },
            },
          },
          problem: ratingProblem,
        },
        {
          name: "route capability without a top-level capabilities section",
          data: {
            format: 1,
            models: {
              "model-a": {
                family: "family-a",
                routes: [
                  {
                    harness: "harness-x",
                    modelId: "model-id-a",
                    hosted: false,
                    capabilities: ["browser"],
                  },
                ],
              },
            },
          },
          problem: capabilityProblem,
        },
        {
          name: "route capability not in the declared capabilities",
          data: {
            format: 1,
            capabilities: { image: "Sees images." },
            models: {
              "model-a": {
                family: "family-a",
                routes: [
                  {
                    harness: "harness-x",
                    modelId: "model-id-a",
                    hosted: false,
                    capabilities: ["browser"],
                  },
                ],
              },
            },
          },
          problem: capabilityProblem,
        },
        {
          name: "route meter without a top-level meters section",
          data: {
            format: 1,
            models: {
              "model-a": {
                family: "family-a",
                routes: [
                  {
                    harness: "harness-x",
                    modelId: "model-id-a",
                    hosted: false,
                    meter: "plan-a",
                  },
                ],
              },
            },
          },
          problem: meterProblem,
        },
        {
          name: "route meter not in the declared meters",
          data: {
            format: 1,
            meters: { "plan-b": { spendToZero: true } },
            models: {
              "model-a": {
                family: "family-a",
                routes: [
                  {
                    harness: "harness-x",
                    modelId: "model-id-a",
                    hosted: false,
                    meter: "plan-a",
                  },
                ],
              },
            },
          },
          problem: meterProblem,
        },
      ];
      for (const testCase of cases) {
        const path = writeJson(dir, `${testCase.name.replace(/\W+/g, "-")}.json`, testCase.data);
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe("reference-unknown");
        expect(error.problems, testCase.name).toEqual([testCase.problem]);
      }
    });
  });

  test("several bad references in one file report one problem per reference, in order", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "four-unknown-references.json", {
        format: 1,
        ratings: { declared: "Declared and described." },
        capabilities: { declared: "Declared and described." },
        meters: { "plan-declared": { spendToZero: true } },
        models: {
          "model-a": {
            family: "family-a",
            ratings: { taste: 7 },
            routes: [
              {
                harness: "harness-x",
                modelId: "model-id-a",
                hosted: false,
                capabilities: ["unknown-a", "declared", "unknown-b"],
                meter: "plan-unknown",
              },
            ],
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("reference-unknown");
      expect(error.problems.map((problem) => problem.field)).toEqual([
        '$["models"]["model-a"]["ratings"]["taste"]',
        '$["models"]["model-a"]["routes"][0]["capabilities"][0]',
        '$["models"]["model-a"]["routes"][0]["capabilities"][2]',
        '$["models"]["model-a"]["routes"][0]["meter"]',
      ]);
    });
  });

  test("a wrongly shaped declaration section is a shape problem, never a false reference-unknown", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "bad-declaration-sections.json", {
        format: 1,
        ratings: "not an object",
        capabilities: ["browser"],
        meters: "not an object",
        models: {
          "model-a": {
            family: "family-a",
            ratings: { coding: 7 },
            routes: [
              {
                harness: "harness-x",
                modelId: "model-id-a",
                hosted: false,
                capabilities: ["browser"],
                meter: "plan-a",
              },
            ],
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(error.problems.map((problem) => problem.field).sort()).toEqual([
        '$["capabilities"]',
        '$["meters"]',
        '$["ratings"]',
      ]);
      expect(error.problems.every((problem) => problem.code === "registry-invalid")).toBe(true);
    });
  });

  test("DW10 a model rating outside 1 to 10, or a non-integer, fails with registry-invalid", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{ name: string; rating: unknown }> = [
        { name: "below the range", rating: 0 },
        { name: "above the range", rating: 11 },
        { name: "fractional", rating: 5.5 },
        { name: "string", rating: "5" },
        { name: "boolean", rating: true },
        { name: "null", rating: null },
      ];
      for (const testCase of cases) {
        const path = writeJson(dir, `${testCase.name.replace(/\W+/g, "-")}.json`, {
          format: 1,
          ratings: { coding: "Writes and changes code." },
          models: {
            "model-a": {
              family: "family-a",
              ratings: { coding: testCase.rating },
              routes: [],
            },
          },
        });
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe("registry-invalid");
        expect(error.problems, testCase.name).toEqual([
          {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["ratings"]["coding"]',
            fix: 'Set the rating "coding" of model "model-a" to an integer from 1 to 10.',
            message: 'the rating "coding" of model "model-a" must be an integer from 1 to 10',
          },
        ]);
      }
    });
  });

  test("DW11 maxEffort or fixedEffort off the ladder fails with registry-invalid", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{ name: string; effortKey: "maxEffort" | "fixedEffort" }> = [
        { name: "maxEffort off ladder", effortKey: "maxEffort" },
        { name: "fixedEffort off ladder", effortKey: "fixedEffort" },
      ];
      for (const testCase of cases) {
        const path = writeJson(dir, `${testCase.name.replace(/\W+/g, "-")}.json`, {
          format: 1,
          models: {
            "model-a": {
              family: "family-a",
              routes: [],
              [testCase.effortKey]: "off-the-ladder",
            },
          },
        });
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe("registry-invalid");
        expect(error.problems, testCase.name).toEqual([
          {
            code: "registry-invalid",
            field: `$["models"]["model-a"]["${testCase.effortKey}"]`,
            fix: `Set "${testCase.effortKey}" to one of low, medium, high, xhigh, max.`,
            message: `the field "${testCase.effortKey}" must be one of low, medium, high, xhigh, max`,
          },
        ]);
      }
    });
  });

  test("rating bounds 1 and 10 are accepted", async () => {
    await withTempDir(async (dir) => {
      for (const value of [1, 10] as const) {
        const path = writeJson(dir, `rating-bound-${value}.json`, {
          format: 1,
          ratings: { coding: "Writes and changes code." },
          models: {
            "model-a": { family: "family-a", ratings: { coding: value }, routes: [] },
          },
        });
        const loaded = loadRegistry({ path });
        expect(loaded.registry.models["model-a"]?.ratings).toEqual({ coding: value });
      }
    });
  });

  test("every effort ladder level is accepted on maxEffort and fixedEffort", async () => {
    await withTempDir(async (dir) => {
      for (const level of EFFORT_LADDER) {
        const path = writeJson(dir, `effort-${level}.json`, {
          format: 1,
          models: {
            "model-a": { family: "family-a", maxEffort: level, fixedEffort: level, routes: [] },
          },
        });
        const loaded = loadRegistry({ path });
        expect(loaded.registry.models["model-a"]?.maxEffort).toBe(level);
        expect(loaded.registry.models["model-a"]?.fixedEffort).toBe(level);
      }
    });
  });

  test("DW12 a file with only format and models passes check", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "minimal.json", {
        format: 1,
        models: {
          "model-a": {
            family: "family-a",
            routes: [],
          },
        },
      });
      const loaded = loadRegistry({ path });
      expect(loaded.registry.models["model-a"]?.family).toBe("family-a");
      expect(Object.keys(loaded.registry)).toEqual(["models"]);
      expect(loaded.routes).toEqual({});
      expect(loaded.sections).toEqual({});
      const result = runBuiltCli(["check", "--registry", path]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
    });
  });

  test("DW13 the effort ladder is exported in order", () => {
    expect(EFFORT_LADDER).toEqual(["low", "medium", "high", "xhigh", "max"]);
    const publishedSchema = JSON.parse(
      readFileSync(join(repoRoot, "registry.schema.json"), "utf8"),
    ) as { $defs?: Record<string, { enum?: unknown }> };
    const enumValues = publishedSchema.$defs?.effortLevel?.enum;
    expect(enumValues).toEqual(EFFORT_LADDER);
    expect(new Set(EFFORT_LADDER).size).toBe(EFFORT_LADDER.length);
  });

  test("DW14 examples/registry.json declares placeholder ratings, capabilities and a meter with spendToZero, and passes check", () => {
    const example = JSON.parse(exampleBytes.toString("utf8")) as {
      ratings?: Record<string, string>;
      capabilities?: Record<string, string>;
      meters?: Record<string, { spendToZero?: unknown; notes?: unknown }>;
      models?: Record<
        string,
        {
          ratings?: Record<string, number>;
          maxEffort?: string;
          routes?: Array<{ capabilities?: string[]; meter?: string }>;
        }
      >;
    };
    expect(Object.keys(loadRegistry({ path: examplePath }).registry)).toEqual([
      "models",
      "ratings",
      "capabilities",
      "meters",
      "calibration",
    ]);
    expect(example.ratings).toBeDefined();
    expect(Object.values(example.ratings ?? {}).every((value) => typeof value === "string")).toBe(
      true,
    );
    expect(example.capabilities).toBeDefined();
    expect(
      Object.values(example.capabilities ?? {}).every((value) => typeof value === "string"),
    ).toBe(true);
    expect(example.meters).toBeDefined();
    const meterNames = Object.keys(example.meters ?? {});
    expect(meterNames.length).toBeGreaterThan(0);
    expect(
      meterNames.some((name) => example.meters?.[name]?.spendToZero === true),
      "some meter spends to zero",
    ).toBe(true);
    const declaredCapabilities = new Set(Object.keys(example.capabilities ?? {}));
    const declaredMeters = new Set(meterNames);
    const routes = Object.values(example.models ?? {}).flatMap((model) => model?.routes ?? []);
    expect(
      routes.some((route) =>
        (route?.capabilities ?? []).some((name) => declaredCapabilities.has(name)),
      ),
      "some route references a declared capability",
    ).toBe(true);
    expect(
      routes.some((route) => route?.meter !== undefined && declaredMeters.has(route.meter)),
      "some route references a declared meter",
    ).toBe(true);
    const model = example.models?.["model-a"];
    expect(model?.ratings).toBeDefined();
    expect(Object.keys(model?.ratings ?? {}).length).toBeGreaterThan(0);
    for (const rating of Object.values(model?.ratings ?? {})) {
      expect(Number.isInteger(rating)).toBe(true);
      expect(rating).toBeGreaterThanOrEqual(1);
      expect(rating).toBeLessThanOrEqual(10);
    }

    const result = runBuiltCli(["check", "--registry", "examples/registry.json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed.format).toBe(1);
  });

  test("DW3 the example declares one budget profile beside the implicit default, with one gap of each form", () => {
    const example = JSON.parse(exampleBytes.toString("utf8")) as {
      profiles?: Record<
        string,
        {
          description?: string;
          routes?: string[];
          gaps?: Array<{
            rating?: string;
            accepts?: number;
            capability?: string;
            reason?: string;
          }>;
        }
      >;
    };
    expect(Object.keys(example.profiles ?? {})).toEqual(["budget"]);
    const budget = example.profiles?.budget;
    expect(typeof budget?.description).toBe("string");
    expect(budget?.description).not.toBe("");
    expect(budget?.routes).toEqual(["model-a@harness-y/provider-1"]);
    const gaps = budget?.gaps ?? [];
    expect(gaps).toHaveLength(2);
    const ratingGaps = gaps.filter((gap) => gap?.rating !== undefined);
    expect(ratingGaps).toHaveLength(1);
    expect(ratingGaps[0]?.rating).toBe("coding");
    expect(ratingGaps[0]?.accepts).toBe(7);
    const capabilityGaps = gaps.filter((gap) => gap?.capability !== undefined);
    expect(capabilityGaps).toHaveLength(1);
    expect(capabilityGaps[0]?.capability).toBe("browser");
    for (const gap of gaps) {
      expect(typeof gap?.reason).toBe("string");
      expect(gap?.reason).not.toBe("");
    }
  });

  test("DW4 the example loads with the budget profile beside the implicit default, and its gaps are not stale against its members", () => {
    const loaded = loadRegistry({ path: examplePath });
    expect(Object.keys(loaded.profiles)).toEqual(["default", "budget"]);
    expect(loaded.profileProvenance).toEqual({ default: "implicit", budget: "declared" });
    expect(loaded.profiles.default?.routes).toEqual(Object.keys(loaded.routes));
    expect(Object.keys(loaded.profiles.default ?? {})).toEqual(["routes"]);
    const example = JSON.parse(exampleBytes.toString("utf8")) as {
      profiles?: Record<string, unknown>;
    };
    const budget = loaded.profiles.budget;
    expect(budget?.description).toBe(
      (example.profiles?.budget as { description?: string } | undefined)?.description,
    );
    expect(budget?.routes).toEqual(["model-a@harness-y/provider-1"]);
    const gaps = budget?.gaps ?? [];
    expect(gaps).toHaveLength(2);
    const members = (budget?.routes ?? []).map((label) => loaded.routes[label]);
    expect(members).toHaveLength(1);
    for (const gap of gaps) {
      if ("capability" in gap) {
        expect(
          members.some((route) => route?.capabilities?.includes(gap.capability) ?? false),
          `no member carries the waived capability ${gap.capability}`,
        ).toBe(false);
      }
      if ("rating" in gap) {
        for (const route of members) {
          const rating = route
            ? loaded.registry.models[route.model]?.ratings?.[gap.rating]
            : undefined;
          expect(rating ?? 0).toBeLessThanOrEqual(gap.accepts);
        }
      }
    }
  });
});
