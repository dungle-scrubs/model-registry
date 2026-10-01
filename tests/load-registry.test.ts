import { spawnSync } from "node:child_process";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import * as publicApi from "../src/index.js";
import { loadRegistry } from "../src/load-registry.js";
import { resolveRegistryPath } from "../src/path.js";
import type { RegistryProblem } from "../src/types.js";
import {
  builtIndexPath,
  catchRegistryError,
  createXdgConfigHome,
  repoRoot,
  sha256Hex,
  withEnv,
  withTempDir,
  writeJson,
} from "./helpers.js";

const validRegistry = {
  format: 1,
  models: {
    "model-a": {
      family: "family-a",
      routes: [{ harness: "harness-x", modelId: "model-id-a", hosted: false }],
    },
  },
};

function modelWithRoutes(routes: unknown[]): unknown {
  return { family: "family-a", routes };
}

describe("curated problems", () => {
  test("every fault maps to its exact curated problem", async () => {
    await withTempDir(async (dir) => {
      const route = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
        harness: "harness-x",
        modelId: "model-id-a",
        hosted: false,
        ...patch,
      });
      const model = (
        patch: Record<string, unknown> = {},
        routes: unknown[] = [route()],
      ): Record<string, unknown> => ({
        family: "family-a",
        routes,
        ...patch,
      });
      const registry = (models: unknown, extra: Record<string, unknown> = {}): unknown => ({
        format: 1,
        models,
        ...extra,
      });
      const modelEntry = (modelValue: unknown): unknown => ({ "model-a": modelValue });

      const cases: Array<{
        name: string;
        problem: RegistryProblem;
        value?: unknown;
        // Raw JSON text: JSON.stringify would rewrite Infinity as null.
        content?: string;
      }> = [
        {
          name: "root not an object",
          value: [],
          problem: {
            code: "registry-invalid",
            field: "$",
            message: "the registry root must be a JSON object",
            fix: "Give the file a JSON object with a format field and a models object.",
          },
        },
        {
          name: "format missing",
          value: { models: {} },
          problem: {
            code: "format-missing",
            field: '$["format"]',
            message: "the file has no format field, so it is not a version 1 registry",
            fix: 'Add "format": 1 at the top of the registry file.',
          },
        },
        {
          name: "format not an integer",
          value: { format: 1.5, models: {} },
          problem: {
            code: "registry-invalid",
            field: '$["format"]',
            message: "the format field must be the integer 1",
            fix: 'Set "format": 1 at the top of the registry file.',
          },
        },
        {
          name: "format newer",
          value: { format: 2, models: {} },
          problem: {
            code: "format-unsupported",
            field: '$["format"]',
            message: "format 2 is newer than the format 1 this model-registry supports",
            fix: "Upgrade model-registry to a release that supports format 2.",
          },
        },
        {
          name: "format older",
          value: { format: 0, models: {} },
          problem: {
            code: "format-unsupported",
            field: '$["format"]',
            message: "format 0 is older than format 1",
            fix: "Recreate the file as a format 1 registry; no migration into format 1 ships.",
          },
        },
        {
          name: "models missing",
          value: { format: 1 },
          problem: {
            code: "registry-invalid",
            field: '$["models"]',
            message: 'the required field "models" is missing',
            fix: "Add a models object with one entry per model.",
          },
        },
        {
          name: "models wrong type",
          value: registry([]),
          problem: {
            code: "registry-invalid",
            field: '$["models"]',
            message: 'the field "models" must be a JSON object keyed by model key',
            fix: "Replace models with a JSON object keyed by model key.",
          },
        },
        {
          name: "model not an object",
          value: registry(modelEntry("x")),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]',
            message: 'the model "model-a" must be a JSON object',
            fix: "Replace the model with a JSON object.",
          },
        },
        {
          name: "family missing",
          value: registry(modelEntry({ routes: [] })),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["family"]',
            message: 'the required field "family" is missing',
            fix: 'Add a "family" string.',
          },
        },
        {
          name: "family wrong type",
          value: registry(modelEntry(model({ family: 5 }))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["family"]',
            message: 'the field "family" must be a string',
            fix: 'Set "family" to a string.',
          },
        },
        {
          name: "model notes wrong type",
          value: registry(modelEntry(model({ notes: 5 }))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["notes"]',
            message: 'the field "notes" must be a string',
            fix: 'Set "notes" to a string, or remove it.',
          },
        },
        {
          name: "routes missing",
          value: registry(modelEntry({ family: "family-a" })),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"]',
            message: 'the model "model-a" is missing the required field "routes"',
            fix: "Add a routes array to the model; an empty array is valid.",
          },
        },
        {
          name: "routes wrong type",
          value: registry(modelEntry({ family: "family-a", routes: {} })),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"]',
            message: "the routes field must be an array",
            fix: "Set routes to an array of route objects.",
          },
        },
        {
          name: "unknown model field",
          value: registry(modelEntry(model({ surprise: 1 }))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["surprise"]',
            message: 'the field "surprise" is not part of a format 1 model',
            fix: "Remove the field, or move free text into notes.",
          },
        },
        {
          name: "route not an object",
          value: registry(modelEntry({ family: "family-a", routes: ["x"] })),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]',
            message: "the route must be a JSON object",
            fix: "Replace the route with a JSON object.",
          },
        },
        {
          name: "harness missing",
          value: registry(modelEntry(model({}, [{ modelId: "model-id-a", hosted: false }]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["harness"]',
            message: 'the required field "harness" is missing',
            fix: 'Add a "harness" string.',
          },
        },
        {
          name: "harness wrong type",
          value: registry(modelEntry(model({}, [route({ harness: 5 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["harness"]',
            message: 'the field "harness" must be a string',
            fix: 'Set "harness" to a string.',
          },
        },
        {
          name: "modelId missing",
          value: registry(modelEntry(model({}, [{ harness: "harness-x", hosted: false }]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["modelId"]',
            message: 'the required field "modelId" is missing',
            fix: 'Add a "modelId" string.',
          },
        },
        {
          name: "modelId wrong type",
          value: registry(modelEntry(model({}, [route({ modelId: 5 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["modelId"]',
            message: 'the field "modelId" must be a string',
            fix: 'Set "modelId" to a string.',
          },
        },
        {
          name: "hosted missing",
          value: registry(modelEntry(model({}, [{ harness: "harness-x", modelId: "model-id-a" }]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["hosted"]',
            message: 'the required field "hosted" is missing',
            fix: 'Add a "hosted" boolean; a wrong guess either way is a privacy fault.',
          },
        },
        {
          name: "hosted wrong type",
          value: registry(modelEntry(model({}, [route({ hosted: "yes" })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["hosted"]',
            message: 'the field "hosted" must be a boolean',
            fix: 'Set "hosted" to true or false.',
          },
        },
        {
          name: "provider wrong type",
          value: registry(modelEntry(model({}, [route({ provider: 5 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["provider"]',
            message: 'the field "provider" must be a string',
            fix: 'Set "provider" to a string, or remove it.',
          },
        },
        {
          name: "privacyEligible wrong type",
          value: registry(modelEntry(model({}, [route({ privacyEligible: 1 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["privacyEligible"]',
            message: 'the field "privacyEligible" must be a boolean',
            fix: 'Set "privacyEligible" to true or false, or remove it.',
          },
        },
        {
          name: "cost fractional",
          value: registry(modelEntry(model({}, [route({ cost: 5.5 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["cost"]',
            message: 'the field "cost" must be an integer from 1 to 10',
            fix: 'Set "cost" to an integer from 1 (expensive) to 10 (cheap).',
          },
        },
        {
          name: "cost below the range",
          value: registry(modelEntry(model({}, [route({ cost: 0 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["cost"]',
            message: 'the field "cost" must be an integer from 1 to 10',
            fix: 'Set "cost" to an integer from 1 (expensive) to 10 (cheap).',
          },
        },
        {
          name: "cost above the range",
          value: registry(modelEntry(model({}, [route({ cost: 11 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["cost"]',
            message: 'the field "cost" must be an integer from 1 to 10',
            fix: 'Set "cost" to an integer from 1 (expensive) to 10 (cheap).',
          },
        },
        {
          name: "rateLimitRpm wrong type",
          value: registry(modelEntry(model({}, [route({ rateLimitRpm: "5" })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["rateLimitRpm"]',
            message: 'the field "rateLimitRpm" must be a number of 0 or more',
            fix: 'Set "rateLimitRpm" to a finite number of 0 or more.',
          },
        },
        {
          name: "rateLimitRpm negative",
          value: registry(modelEntry(model({}, [route({ rateLimitRpm: -1 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["rateLimitRpm"]',
            message: 'the field "rateLimitRpm" must be a number of 0 or more',
            fix: 'Set "rateLimitRpm" to a finite number of 0 or more.',
          },
        },
        {
          name: "responseSeconds negative",
          value: registry(modelEntry(model({}, [route({ responseSeconds: -0.5 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["responseSeconds"]',
            message: 'the field "responseSeconds" must be a number of 0 or more',
            fix: 'Set "responseSeconds" to a finite number of 0 or more.',
          },
        },
        {
          name: "route notes wrong type",
          value: registry(modelEntry(model({}, [route({ notes: 5 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["notes"]',
            message: 'the field "notes" must be a string',
            fix: 'Set "notes" to a string, or remove it.',
          },
        },
        {
          name: "unknown route field",
          value: registry(modelEntry(model({}, [route({ surprise: 1 })]))),
          problem: {
            code: "registry-invalid",
            field: '$["models"]["model-a"]["routes"][0]["surprise"]',
            message: 'the field "surprise" is not part of a format 1 route',
            fix: "Remove the field, or move free text into notes.",
          },
        },
        {
          name: "null nested in a foreign section",
          value: registry({}, { router: { keys: ["a", null] } }),
          problem: {
            code: "registry-invalid",
            field: '$["router"]["keys"][1]',
            message: "null is not a valid value anywhere in a registry file",
            fix: "Replace the null with the field's value, or remove the field.",
          },
        },
        {
          name: "non-finite number in a foreign section",
          content: '{"format":1,"models":{},"router":{"value":1e400}}',
          problem: {
            code: "registry-invalid",
            field: '$["router"]["value"]',
            message: "numbers in a registry file must be finite",
            fix: "Rewrite the number so it stays within double-precision range, for example 1e308 rather than 1e400.",
          },
        },
        {
          name: "duplicate route label",
          value: registry(modelEntry(model({}, [route(), route({ modelId: "model-id-b" })]))),
          problem: {
            code: "label-duplicate",
            field: '$["models"]["model-a"]["routes"][1]',
            message:
              'the route label "model-a@harness-x" is already used by the route at $["models"]["model-a"]["routes"][0]',
            fix: "Change the harness or provider of one of the two routes so that every label is unique.",
          },
        },
      ];
      for (const testCase of cases) {
        const path = join(dir, `${testCase.name.replace(/\W+/g, "-")}.json`);
        writeFileSync(path, testCase.content ?? JSON.stringify(testCase.value));
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.problems, testCase.name).toEqual([testCase.problem]);
      }
    });
  });
});

describe("loadRegistry", () => {
  test("digest covers the file bytes, not normalized JSON", async () => {
    await withTempDir(async (dir) => {
      const compact = join(dir, "compact.json");
      const spaced = join(dir, "spaced.json");
      writeFileSync(compact, JSON.stringify(validRegistry));
      writeFileSync(spaced, `${JSON.stringify(validRegistry, null, 4)}\n`);
      expect(loadRegistry({ path: compact }).digest).not.toBe(
        loadRegistry({ path: spaced }).digest,
      );
      expect(loadRegistry({ path: compact }).digest).toBe(
        `sha256:${sha256Hex(readFileSync(compact))}`,
      );
      expect(loadRegistry({ path: spaced }).digest).toBe(
        `sha256:${sha256Hex(readFileSync(spaced))}`,
      );
    });
  });

  test("a foreign-section edit changes the digest", async () => {
    await withTempDir(async (dir) => {
      const without = writeJson(dir, "without.json", validRegistry);
      const withSection = writeJson(dir, "with-section.json", {
        ...validRegistry,
        "extension-a": { note: "placeholder" },
      });
      expect(loadRegistry({ path: without }).digest).not.toBe(
        loadRegistry({ path: withSection }).digest,
      );
    });
  });

  test("the registry file is unchanged after success and failure", async () => {
    await withTempDir(async (dir) => {
      const okPath = writeJson(dir, "ok.json", validRegistry);
      const before = readFileSync(okPath);
      loadRegistry({ path: okPath });
      expect(readFileSync(okPath)).toEqual(before);

      const badPath = writeJson(dir, "bad.json", {
        format: 1,
        models: { "model-a": { family: 5, routes: [] } },
      });
      const badBefore = readFileSync(badPath);
      catchRegistryError(() => loadRegistry({ path: badPath }));
      expect(readFileSync(badPath)).toEqual(badBefore);
    });
  });

  test("invalid JSON gives registry-unreadable", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "broken.json");
      writeFileSync(path, '{"format": 1,,}');
      expect(catchRegistryError(() => loadRegistry({ path })).code).toBe("registry-unreadable");
    });
  });

  test("format faults give their exact codes", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{ name: string; content: string; code: string; fixPart?: string }> = [
        { name: "missing", content: '{"models":{}}', code: "format-missing" },
        {
          name: "higher",
          content: '{"format":2,"models":{}}',
          code: "format-unsupported",
          fixPart: "Upgrade model-registry",
        },
        {
          name: "lower",
          content: '{"format":0,"models":{}}',
          code: "format-unsupported",
          fixPart: "no migration into format 1",
        },
        {
          name: "negative",
          content: '{"format":-1,"models":{}}',
          code: "format-unsupported",
          fixPart: "no migration into format 1",
        },
        { name: "string", content: '{"format":"1","models":{}}', code: "registry-invalid" },
        { name: "fractional", content: '{"format":1.5,"models":{}}', code: "registry-invalid" },
        { name: "boolean", content: '{"format":true,"models":{}}', code: "registry-invalid" },
        { name: "null", content: '{"format":null,"models":{}}', code: "registry-invalid" },
        { name: "root array", content: "[]", code: "registry-invalid" },
        { name: "root null", content: "null", code: "registry-invalid" },
        { name: "root string", content: '"registry"', code: "registry-invalid" },
      ];
      for (const testCase of cases) {
        const path = join(dir, `${testCase.name.replace(/\W+/g, "-")}.json`);
        writeFileSync(path, testCase.content);
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe(testCase.code);
        if (testCase.fixPart !== undefined) {
          expect(error.fix, testCase.name).toContain(testCase.fixPart);
        }
      }
    });
  });

  test("empty models and empty route arrays are accepted", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "empty.json", { format: 1, models: {} });
      const loaded = loadRegistry({ path });
      expect(loaded.registry.models).toEqual({});
      expect(loaded.routes).toEqual({});
      expect(loaded.sections).toEqual({});

      const modelNoRoutes = writeJson(dir, "no-routes.json", {
        format: 1,
        models: { "model-a": modelWithRoutes([]) },
      });
      expect(loadRegistry({ path: modelNoRoutes }).routes).toEqual({});
    });
  });

  test("loadRegistry with an empty path names the empty path", () => {
    const error = catchRegistryError(() => loadRegistry({ path: "" }));
    expect(error.code).toBe("registry-missing");
    expect(error.path).toBe("");
  });

  test("relative paths resolve against the working directory", async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, "registry.json"), JSON.stringify(validRegistry));
      const script = `import(${JSON.stringify(pathToFileURL(builtIndexPath).href)}).then((m) => {
        const loaded = m.loadRegistry({ path: "registry.json" });
        process.stdout.write(loaded.path + "\\n" + process.cwd());
      });`;
      const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", cwd: dir });
      expect(result.stderr).toBe("");
      const [reportedPath, cwd] = (result.stdout ?? "").split("\n");
      expect(reportedPath).toBe(resolve(cwd ?? "", "registry.json"));
      expect(reportedPath?.endsWith("registry.json")).toBe(true);
    });
  });

  test.skipIf(process.platform === "win32")(
    "a symlinked path is returned without resolving the link",
    async () => {
      await withTempDir(async (dir) => {
        const target = writeJson(dir, "target.json", validRegistry);
        const link = join(dir, "link.json");
        symlinkSync(target, link);
        expect(loadRegistry({ path: link }).path).toBe(link);
      });
    },
  );

  test("a literal tilde is never expanded", () => {
    const error = catchRegistryError(() => loadRegistry({ path: "~" }));
    expect(error.code).toBe("registry-missing");
    expect(error.path).toBe(resolve("~"));
    expect(error.path.endsWith("~")).toBe(true);
  });

  test("empty environment values count as unset", async () => {
    await withTempDir(async (dir) => {
      const xdg = createXdgConfigHome(dir, validRegistry);
      await withEnv({ MODEL_REGISTRY_FILE: "", XDG_CONFIG_HOME: xdg }, () => {
        expect(loadRegistry().path).toBe(join(xdg, "model-registry", "registry.json"));
      });
      const home = join(dir, "home");
      expect(resolveRegistryPath(undefined, { XDG_CONFIG_HOME: "" }, home)).toBe(
        join(home, ".config", "model-registry", "registry.json"),
      );
    });
  });

  test("a directory at the path gives registry-unreadable", async () => {
    await withTempDir(async (dir) => {
      expect(catchRegistryError(() => loadRegistry({ path: dir })).code).toBe(
        "registry-unreadable",
      );
    });
  });

  test("the aggregate code follows the settlement", async () => {
    await withTempDir(async (dir) => {
      const duplicated = writeJson(dir, "duplicated.json", {
        format: 1,
        models: {
          "model-a": modelWithRoutes([
            { harness: "harness-x", modelId: "model-id-a", hosted: false },
            { harness: "harness-x", modelId: "model-id-b", hosted: true },
          ]),
          "model-b": modelWithRoutes([
            { harness: "harness-y", modelId: "model-id-c", hosted: false },
            { harness: "harness-y", modelId: "model-id-d", hosted: true },
          ]),
        },
      });
      const duplicateError = catchRegistryError(() => loadRegistry({ path: duplicated }));
      expect(duplicateError.code).toBe("label-duplicate");
      expect(duplicateError.problems).toHaveLength(2);
      expect(duplicateError.problems.every((problem) => problem.code === "label-duplicate")).toBe(
        true,
      );
      expect(duplicateError.problems[1]?.field).toContain("model-b");
      expect(duplicateError.problems[1]?.field).toContain('routes"][1]');

      const mixed = writeJson(dir, "mixed.json", {
        format: 1,
        models: {
          "model-a": {
            family: "family-a",
            extra: true,
            routes: [
              { harness: "harness-x", modelId: "model-id-a", hosted: false },
              { harness: "harness-x", modelId: "model-id-b", hosted: true },
            ],
          },
        },
      });
      const mixedError = catchRegistryError(() => loadRegistry({ path: mixed }));
      expect(mixedError.code).toBe("registry-invalid");
      expect(mixedError.problems.map((problem) => problem.code).sort()).toEqual([
        "label-duplicate",
        "registry-invalid",
      ]);
    });
  });

  test("the deferred calibration section is rejected with a later-slice fix", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "calibration.json", {
        format: 1,
        models: {},
        calibration: { handSet: ["taste"] },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      const problem = error.problems.find((candidate) => candidate.field === '$["calibration"]');
      expect(problem).toBeDefined();
      expect(problem?.fix).toContain("later format slice");
    });
  });

  test("undeclared model rating, route capability and route meter fail with reference-unknown", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{
        name: string;
        data: unknown;
        field: string;
        name_: string;
        kind: string;
      }> = [
        {
          name: "model rating without a ratings section",
          data: {
            format: 1,
            models: {
              "model-a": {
                family: "family-a",
                ratings: { coding: 7 },
                routes: [],
              },
            },
          },
          field: '$["models"]["model-a"]["ratings"]["coding"]',
          name_: "coding",
          kind: "rating",
        },
        {
          name: "model rating not in the declared ratings",
          data: {
            format: 1,
            ratings: { taste: "Subjective." },
            models: {
              "model-a": {
                family: "family-a",
                ratings: { coding: 7 },
                routes: [],
              },
            },
          },
          field: '$["models"]["model-a"]["ratings"]["coding"]',
          name_: "coding",
          kind: "rating",
        },
        {
          name: "route capability without a capabilities section",
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
          field: '$["models"]["model-a"]["routes"][0]["capabilities"][0]',
          name_: "browser",
          kind: "capability",
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
          field: '$["models"]["model-a"]["routes"][0]["capabilities"][0]',
          name_: "browser",
          kind: "capability",
        },
        {
          name: "route meter without a meters section",
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
          field: '$["models"]["model-a"]["routes"][0]["meter"]',
          name_: "plan-a",
          kind: "meter",
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
          field: '$["models"]["model-a"]["routes"][0]["meter"]',
          name_: "plan-a",
          kind: "meter",
        },
      ];
      for (const testCase of cases) {
        const path = writeJson(dir, `${testCase.name.replace(/\W+/g, "-")}.json`, testCase.data);
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe("reference-unknown");
        const problem = error.problems.find((candidate) => candidate.field === testCase.field);
        expect(problem, testCase.name).toBeDefined();
        expect(problem?.message, testCase.name).toContain(`"${testCase.name_}"`);
        expect(problem?.message, testCase.name).toContain(`${testCase.kind}s section`);
      }
    });
  });

  test("every declared reference passes", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "declared.json", {
        format: 1,
        ratings: { coding: "Writes and changes code." },
        capabilities: { browser: "Can drive a browser." },
        meters: { "plan-a": { spendToZero: true } },
        models: {
          "model-a": {
            family: "family-a",
            ratings: { coding: 7 },
            maxEffort: "high",
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
      const loaded = loadRegistry({ path });
      expect(loaded.registry.models["model-a"]?.ratings).toEqual({ coding: 7 });
      expect(loaded.registry.models["model-a"]?.maxEffort).toBe("high");
      const route = loaded.routes["model-a@harness-x"];
      expect(route?.capabilities).toEqual(["browser"]);
      expect(route?.meter).toBe("plan-a");
    });
  });

  test("model ratings outside 1 to 10 and non-integers fail with registry-invalid", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{ name: string; rating: unknown }> = [
        { name: "below range", rating: 0 },
        { name: "above range", rating: 11 },
        { name: "fractional", rating: 5.5 },
        { name: "string", rating: "5" },
        { name: "boolean", rating: true },
      ];
      for (const testCase of cases) {
        const path = writeJson(dir, `${testCase.name}.json`, {
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
        const problem = error.problems.find(
          (candidate) => candidate.field === '$["models"]["model-a"]["ratings"]["coding"]',
        );
        expect(problem, testCase.name).toBeDefined();
      }
    });
  });

  test("maxEffort and fixedEffort off the ladder fail with registry-invalid", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{ name: string; field: string; effortKey: string }> = [
        {
          name: "maxEffort off ladder",
          field: '$["models"]["model-a"]["maxEffort"]',
          effortKey: "maxEffort",
        },
        {
          name: "fixedEffort off ladder",
          field: '$["models"]["model-a"]["fixedEffort"]',
          effortKey: "fixedEffort",
        },
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
        const problem = error.problems.find((candidate) => candidate.field === testCase.field);
        expect(problem, testCase.name).toBeDefined();
        expect(problem?.message, testCase.name).toContain("low, medium, high, xhigh, max");
        expect(problem?.fix, testCase.name).toContain("low, medium, high, xhigh, max");
      }
    });
  });

  test("cost, rate and response bounds are enforced", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{ name: string; route: Record<string, unknown>; field: string }> = [
        { name: "cost-below", route: { cost: 0 }, field: "cost" },
        { name: "cost-above", route: { cost: 11 }, field: "cost" },
        { name: "cost-fractional", route: { cost: 5.5 }, field: "cost" },
        { name: "rate-negative", route: { rateLimitRpm: -1 }, field: "rateLimitRpm" },
        { name: "response-negative", route: { responseSeconds: -0.1 }, field: "responseSeconds" },
        { name: "rate-not-number", route: { rateLimitRpm: "10" }, field: "rateLimitRpm" },
      ];
      for (const testCase of cases) {
        const path = writeJson(dir, `${testCase.name}.json`, {
          format: 1,
          models: {
            "model-a": modelWithRoutes([
              { harness: "harness-x", modelId: "model-id-a", hosted: false, ...testCase.route },
            ]),
          },
        });
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(
          error.problems.some((problem) => problem.field.endsWith(`["${testCase.field}"]`)),
          testCase.name,
        ).toBe(true);
      }

      const accepted = writeJson(dir, "accepted.json", {
        format: 1,
        models: {
          "model-a": modelWithRoutes([
            {
              harness: "harness-x",
              modelId: "model-id-a",
              hosted: false,
              cost: 1,
              rateLimitRpm: 0,
              responseSeconds: 0.25,
            },
          ]),
        },
      });
      expect(loadRegistry({ path: accepted }).routes["model-a@harness-x"]).toMatchObject({
        cost: 1,
        rateLimitRpm: 0,
        responseSeconds: 0.25,
      });
    });
  });

  test("dangerous keys stay ordinary", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "dangerous.json", {
        format: 1,
        models: {
          ["__proto__"]: modelWithRoutes([
            { harness: "harness-x", modelId: "model-id-a", hosted: false },
          ]),
        },
        constructor: { note: "placeholder" },
        ["__proto__"]: { note: "top-level" },
      });
      const loaded = loadRegistry({ path });
      expect(Object.hasOwn(loaded.registry.models, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(loaded.registry.models)).toBe(Object.prototype);
      expect(Object.hasOwn(loaded.sections, "constructor")).toBe(true);
      expect(Object.hasOwn(loaded.sections, "__proto__")).toBe(true);
      expect(Reflect.get(loaded.sections, "__proto__")).toEqual({ note: "top-level" });
      expect(Object.getPrototypeOf(loaded.sections)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).note).toBeUndefined();
      expect(Object.hasOwn(loaded.routes, "__proto__@harness-x")).toBe(true);
      expect(loaded.routes["__proto__@harness-x"]).toMatchObject({ model: "__proto__" });
      expect(Object.getPrototypeOf(loaded.routes)).toBe(Object.prototype);
    });
  });

  test("keys with quotes, backslashes and control characters produce exact JSONPaths", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{ name: string; key: string; field: string }> = [
        {
          name: "quote",
          key: 'a"b',
          field: '$["models"]["a\\"b"]["family"]',
        },
        {
          name: "backslash",
          key: "a\\b",
          field: '$["models"]["a\\\\b"]["family"]',
        },
        {
          name: "control-character",
          key: "a\u0001b",
          field: '$["models"]["a\\u0001b"]["family"]',
        },
      ];
      for (const testCase of cases) {
        const path = writeJson(dir, `${testCase.name}.json`, {
          format: 1,
          models: { [testCase.key]: { family: 0, routes: [] } },
        });
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe("registry-invalid");
        expect(
          error.problems.map((problem) => problem.field),
          testCase.name,
        ).toContain(testCase.field);
      }
    });
  });

  test("duplicate detection continues when another route fact is invalid", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "invalid-with-duplicate.json", {
        format: 1,
        models: {
          "model-a": modelWithRoutes([
            { harness: "harness-x", modelId: "model-id-a", hosted: false, cost: 99 },
            { harness: "harness-x", modelId: "model-id-b", hosted: true, extra: 1 },
          ]),
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.problems.map((problem) => problem.code).sort()).toEqual([
        "label-duplicate",
        "registry-invalid",
        "registry-invalid",
      ]);
    });
  });

  test("importing the built library emits nothing and exposes the public symbols", () => {
    // A filesystem path is not a valid ESM specifier on Windows; the file URL is.
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `import(${JSON.stringify(pathToFileURL(builtIndexPath).href)}).then((m) => { process.stdout.write(Object.keys(m).sort().join(",")); });`,
      ],
      { encoding: "utf8", cwd: repoRoot },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("EFFORT_LADDER,RegistryError,buildRouteLabel,loadRegistry");
    expect(Object.keys(publicApi).sort()).toEqual([
      "EFFORT_LADDER",
      "RegistryError",
      "buildRouteLabel",
      "loadRegistry",
    ]);
  });
});
