import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, test } from "vitest";
import { RegistryError } from "../src/error.js";
import { loadRegistry } from "../src/load-registry.js";
import { resolveRegistryPath } from "../src/path.js";
import type { Model, Route } from "../src/types.js";
import {
  examplePath,
  repoRoot,
  runCli,
  sha256Hex,
  withEnv,
  withTempDir,
  writeJson,
  writeXdgRegistry,
} from "./helpers.js";

const exampleBytes = readFileSync(examplePath);

function catchRegistryError(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RegistryError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected loadRegistry to throw");
}

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
afterEach(() => {
  Object.defineProperty(process, "platform", platformDescriptor ?? { value: process.platform });
});

describe("acceptance", () => {
  test("DW1 minimal example check", () => {
    const result = runCli(["check", "--registry", "examples/registry.json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["digest", "format", "path"]);
    expect(parsed.format).toBe(1);
    expect(parsed.digest).toBe(`sha256:${sha256Hex(exampleBytes)}`);
    expect(parsed.path).toBe(resolve(repoRoot, "examples", "registry.json"));
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  test("DW2 registry path precedence", async () => {
    await withTempDir(async (dir) => {
      const explicit = writeJson(dir, "explicit.json", {
        format: 1,
        models: { "model-explicit": { family: "family-a", routes: [] } },
      });
      const environment = writeJson(dir, "environment.json", {
        format: 1,
        models: { "model-environment": { family: "family-a", routes: [] } },
      });
      const xdg = writeXdgRegistry(dir, {
        format: 1,
        models: { "model-xdg": { family: "family-a", routes: [] } },
      });

      // 1. explicit path beats environment and XDG
      await withEnv({ MODEL_REGISTRY_FILE: environment, XDG_CONFIG_HOME: xdg }, () => {
        const loaded = loadRegistry({ path: explicit });
        expect(loaded.digest).toBe(`sha256:${sha256Hex(readFileSync(explicit))}`);
      });

      // 2. MODEL_REGISTRY_FILE beats XDG
      await withEnv({ MODEL_REGISTRY_FILE: environment, XDG_CONFIG_HOME: xdg }, () => {
        const loaded = loadRegistry();
        expect(loaded.digest).toBe(`sha256:${sha256Hex(readFileSync(environment))}`);
      });

      // 3. XDG applies without an explicit or environment path
      await withEnv({ MODEL_REGISTRY_FILE: undefined, XDG_CONFIG_HOME: xdg }, () => {
        const loaded = loadRegistry();
        expect(loaded.digest).toBe(
          `sha256:${sha256Hex(readFileSync(join(xdg, "model-registry", "registry.json")))}`,
        );
      });

      // 4. unset XDG uses <home>/.config/model-registry/registry.json
      const home = join(dir, "home");
      const viaResolver = resolveRegistryPath(undefined, {}, home);
      expect(viaResolver).toBe(join(home, ".config", "model-registry", "registry.json"));

      // 5. the default is unchanged when the platform reports macOS
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      expect(resolveRegistryPath(undefined, {}, home)).toBe(viaResolver);
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

      const result = runCli(["check", "--registry", missing]);
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
      const result = runCli(testCase.args, { MODEL_REGISTRY_FILE: examplePath });
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
    // The loader's own settings: allErrors to collect every fault,
    // strictNumbers to reject non-finite numbers.
    const ajv = new Ajv2020({ allErrors: true, strictNumbers: true });
    const validate = ajv.compile(schema);

    // the published example validates
    expect(validate(JSON.parse(exampleBytes.toString("utf8")))).toBe(true);

    // every supported optional property is valid in both TypeScript and Ajv
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

    // Property tables. Deferred fields are declared as false so the loader
    // can name them without a second source of truth.
    const modelKeys: readonly (keyof Model)[] = ["family", "notes", "routes"];
    const routeKeys: readonly (keyof Route)[] = [
      "harness",
      "modelId",
      "provider",
      "hosted",
      "privacyEligible",
      "cost",
      "rateLimitRpm",
      "responseSeconds",
      "notes",
    ];

    const propertyNames = (properties: Record<string, unknown>, deferred: boolean) =>
      Object.entries(properties)
        .filter(([, definition]) => (definition === false) === deferred)
        .map(([name]) => name)
        .sort();
    expect(propertyNames(schema.$defs.model.properties, false)).toEqual([...modelKeys].sort());
    expect(propertyNames(schema.$defs.model.properties, true)).toEqual([
      "fixedEffort",
      "maxEffort",
      "ratings",
    ]);
    expect(propertyNames(schema.$defs.route.properties, false)).toEqual([...routeKeys].sort());
    expect(propertyNames(schema.$defs.route.properties, true)).toEqual(["capabilities", "meter"]);
    expect(propertyNames(schema.properties, false)).toEqual(["format", "models"]);
    expect(propertyNames(schema.properties, true)).toEqual([
      "calibration",
      "capabilities",
      "meters",
      "ratings",
    ]);

    // negative fixtures fail schema validation
    const negatives: unknown[] = [
      { format: 1, models: { "model-a": { ...fullModel, ratings: { coding: 5 } } } },
      {
        format: 1,
        models: {
          "model-a": {
            ...fullModel,
            routes: [{ ...fullRoute, capabilities: ["browser"] }],
          },
        },
      },
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
    ];
    for (const negative of negatives) {
      expect(validate(negative), JSON.stringify(negative)).toBe(false);
    }
  });
});
