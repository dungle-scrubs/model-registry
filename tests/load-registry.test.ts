import { spawnSync } from "node:child_process";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { RegistryError } from "../src/error.js";
import * as publicApi from "../src/index.js";
import { loadRegistry } from "../src/load-registry.js";
import { resolveRegistryPath } from "../src/path.js";
import {
  builtIndexPath,
  repoRoot,
  sha256Hex,
  withEnv,
  withTempDir,
  writeJson,
  writeXdgRegistry,
} from "./helpers.js";

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
      const xdg = writeXdgRegistry(dir, validRegistry);
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

  test("deferred owned fields are rejected with a later-slice fix", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{ name: string; data: unknown; field: string }> = [
        {
          name: "top-level ratings",
          data: { format: 1, models: {}, ratings: { coding: "Writes code." } },
          field: '$["ratings"]',
        },
        {
          name: "top-level calibration",
          data: { format: 1, models: {}, calibration: {} },
          field: '$["calibration"]',
        },
        {
          name: "model ratings",
          data: {
            format: 1,
            models: { "model-a": { family: "family-a", ratings: {}, routes: [] } },
          },
          field: '$["models"]["model-a"]["ratings"]',
        },
        {
          name: "model maxEffort",
          data: {
            format: 1,
            models: { "model-a": { family: "family-a", maxEffort: "high", routes: [] } },
          },
          field: '$["models"]["model-a"]["maxEffort"]',
        },
        {
          name: "route capabilities",
          data: {
            format: 1,
            models: {
              "model-a": modelWithRoutes([
                {
                  harness: "harness-x",
                  modelId: "model-id-a",
                  hosted: false,
                  capabilities: ["browser"],
                },
              ]),
            },
          },
          field: '$["models"]["model-a"]["routes"][0]["capabilities"]',
        },
        {
          name: "route meter",
          data: {
            format: 1,
            models: {
              "model-a": modelWithRoutes([
                { harness: "harness-x", modelId: "model-id-a", hosted: false, meter: "plan-a" },
              ]),
            },
          },
          field: '$["models"]["model-a"]["routes"][0]["meter"]',
        },
      ];
      for (const testCase of cases) {
        const path = writeJson(dir, `${testCase.name.replace(/\W+/g, "-")}.json`, testCase.data);
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code, testCase.name).toBe("registry-invalid");
        const problem = error.problems.find((candidate) => candidate.field === testCase.field);
        expect(problem, testCase.name).toBeDefined();
        expect(problem?.fix, testCase.name).toContain("later format slice");
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
      });
      const loaded = loadRegistry({ path });
      expect(Object.hasOwn(loaded.registry.models, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(loaded.registry.models)).toBe(Object.prototype);
      expect(Object.hasOwn(loaded.sections, "constructor")).toBe(true);
      expect(Object.getPrototypeOf(loaded.sections)).toBe(Object.prototype);
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
    expect(result.stdout).toBe("RegistryError,buildRouteLabel,loadRegistry");
    expect(Object.keys(publicApi).sort()).toEqual([
      "RegistryError",
      "buildRouteLabel",
      "loadRegistry",
    ]);
  });
});
