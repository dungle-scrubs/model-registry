import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { loadRegistry } from "../src/index.js";
import { AJV_OPTIONS } from "../src/validate.js";
import {
  builtIndexPath,
  catchRegistryError,
  runBuiltCli,
  schemaPath,
  sha256Hex,
  withTempDir,
  writeJson,
} from "./helpers.js";

const routeA = { harness: "harness-x", modelId: "model-a", hosted: false };
const routeB = { ...routeA, provider: "provider-a", modelId: "model-b" };
const labelA = "model-a@harness-x";
const labelB = "model-a@harness-x/provider-a";
const registry = {
  format: 1,
  models: { "model-a": { family: "family-a", routes: [routeA, routeB] } },
};
const budget = { description: "Only a subset.", routes: [labelB, labelA] };
const validate = new Ajv2020(AJV_OPTIONS).compile(JSON.parse(readFileSync(schemaPath, "utf8")));

describe("profiles", () => {
  test("DW6 the built package and published schema agree on declared profiles", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", { ...registry, profiles: { budget } });
      expect(validate(JSON.parse(readFileSync(path, "utf8")))).toBe(true);
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { loadRegistry } from ${JSON.stringify(pathToFileURL(builtIndexPath).href)};
         const loaded = loadRegistry({path: ${JSON.stringify(path)}});
         process.stdout.write(JSON.stringify({profiles: loaded.profiles, provenance: loaded.profileProvenance, sections: loaded.sections}));`,
        ],
        { encoding: "utf8", cwd: dir },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        profiles: { default: { routes: [labelA, labelB] }, budget },
        provenance: { default: "implicit", budget: "declared" },
        sections: {},
      });
    });
  });
  test("DW1 absent profiles supplies every route in an implicit default", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", registry);
      const loaded = loadRegistry({ path });
      expect(loaded.profiles).toEqual({ default: { routes: [labelA, labelB] } });
      expect(loaded.profileProvenance).toEqual({ default: "implicit" });
      expect(Object.keys(loaded.profiles.default ?? {})).toEqual(["routes"]);
    });
  });

  test("DW2 declared profiles retain descriptions and written order after the implicit default", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", { ...registry, profiles: { budget } });
      const loaded = loadRegistry({ path });
      expect(loaded.profiles).toEqual({ default: { routes: [labelA, labelB] }, budget });
      expect(Object.keys(loaded.profiles)).toEqual(["default", "budget"]);
      expect(loaded.profileProvenance).toEqual({ default: "implicit", budget: "declared" });
      expect(Object.keys(loaded.profileProvenance)).toEqual(["default", "budget"]);
    });
  });

  test("DW3 a declared default wins and keeps its file position", async () => {
    await withTempDir((dir) => {
      const declaredDefault = { description: "Narrow default.", routes: [labelB] };
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: { budget, default: declaredDefault },
      });
      const loaded = loadRegistry({ path });
      expect(loaded.profiles).toEqual({ budget, default: declaredDefault });
      expect(Object.keys(loaded.profiles)).toEqual(["budget", "default"]);
      expect(loaded.profileProvenance).toEqual({ budget: "declared", default: "declared" });
      expect(Object.keys(loaded.profileProvenance)).toEqual(["budget", "default"]);
    });
  });

  test("index-like profile names enumerate first in ascending numeric order", async () => {
    await withTempDir((dir) => {
      const declaredDefault = { description: "Narrow default.", routes: [labelB] };
      for (const { profilesText, keys, provenance } of [
        {
          profilesText: `{"budget":${JSON.stringify(budget)},"1":${JSON.stringify(budget)},"01":${JSON.stringify(budget)}}`,
          keys: ["1", "default", "budget", "01"],
          provenance: ["declared", "implicit", "declared", "declared"],
        },
        {
          profilesText: `{"default":${JSON.stringify(declaredDefault)},"2":${JSON.stringify(budget)},"1":${JSON.stringify(budget)}}`,
          keys: ["1", "2", "default"],
          provenance: ["declared", "declared", "declared"],
        },
      ]) {
        const path = writeJson(dir, "registry.json", { ...registry, profiles: {} });
        writeFileSync(
          path,
          readFileSync(path, "utf8").replace('"profiles": {}', `"profiles": ${profilesText}`),
        );
        expect(readFileSync(path, "utf8")).toContain(`"profiles": ${profilesText}`);
        const loaded = loadRegistry({ path });
        expect(Object.keys(loaded.profiles)).toEqual(keys);
        expect(Object.keys(loaded.profileProvenance)).toEqual(keys);
        expect(keys.map((name) => loaded.profileProvenance[name])).toEqual(provenance);
      }
    });
  });

  test("empty sections, empty membership and description conventions are accepted", async () => {
    await withTempDir((dir) => {
      for (const profiles of [
        {},
        { budget: { description: "", routes: [] } },
        { budget: { description: "Two\nlines.", routes: [] } },
      ]) {
        const path = writeJson(dir, "registry.json", { format: 1, models: {}, profiles });
        const loaded = loadRegistry({ path });
        expect(loaded.profiles).toEqual({ default: { routes: [] }, ...profiles });
        expect(loaded.profileProvenance).toEqual(
          Object.hasOwn(profiles, "budget")
            ? { default: "implicit", budget: "declared" }
            : { default: "implicit" },
        );
        expect(validate(JSON.parse(readFileSync(path, "utf8")))).toBe(true);
      }
    });
  });

  test("DW5 RFC-01 fields and bytes stay unchanged with only the two additive result keys", async () => {
    await withTempDir((dir) => {
      const facts = {
        ...registry,
        ratings: { coding: "Writes code." },
        capabilities: { browser: "Drives a browser." },
        meters: { "plan-a": { spendToZero: true } },
        calibration: { notes: "Placeholder evidence." },
        router: { enabled: true },
        tasks: { "task-a": { needs: [] } },
        policy: {},
        "extension-a": [false, 1, "placeholder"],
      };
      const path = writeJson(dir, "registry.json", facts);
      const before = readFileSync(path);
      const loaded = loadRegistry({ path });
      expect({
        format: loaded.format,
        digest: loaded.digest,
        path: loaded.path,
        registry: loaded.registry,
        routes: loaded.routes,
        sections: loaded.sections,
      }).toEqual({
        format: 1,
        digest: `sha256:${sha256Hex(before)}`,
        path,
        registry: {
          models: registry.models,
          ratings: facts.ratings,
          capabilities: facts.capabilities,
          meters: facts.meters,
          calibration: facts.calibration,
        },
        routes: {
          [labelA]: { model: "model-a", ...routeA },
          [labelB]: { model: "model-a", ...routeB },
        },
        sections: {
          router: facts.router,
          tasks: facts.tasks,
          policy: facts.policy,
          "extension-a": facts["extension-a"],
        },
      });
      expect(Object.keys(loaded).sort()).toEqual([
        "digest",
        "format",
        "path",
        "profileProvenance",
        "profiles",
        "registry",
        "routes",
        "sections",
      ]);
      expect(readFileSync(path)).toEqual(before);
      const checked = runBuiltCli(["check", "--registry", path]);
      expect(checked.exitCode).toBe(0);
      expect(checked.stderr).toBe("");
      expect(JSON.parse(checked.stdout)).toEqual({
        format: 1,
        digest: `sha256:${sha256Hex(before)}`,
        path,
      });
    });
  });

  test("DW5 profiles is owned, never a foreign section, and normalization stays read-only", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: { budget },
        router: false,
      });
      const before = readFileSync(path);
      const loaded = loadRegistry({ path });
      expect(loaded.sections).toEqual({ router: false });
      expect(Object.hasOwn(loaded.registry, "profiles")).toBe(false);
      expect(loaded.digest).toBe(`sha256:${sha256Hex(before)}`);
      expect(readFileSync(path)).toEqual(before);
      const checked = runBuiltCli(["check", "--registry", path]);
      expect(checked.exitCode).toBe(0);
      expect(checked.stderr).toBe("");
      expect(JSON.parse(checked.stdout)).toEqual({ format: 1, digest: loaded.digest, path });
    });
  });

  test("prototype and escaped names are ordinary profile keys", async () => {
    await withTempDir((dir) => {
      const profiles = { ["__proto__"]: budget, constructor: budget, 'a"b\\c\n': budget };
      const path = writeJson(dir, "registry.json", { ...registry, profiles });
      const loaded = loadRegistry({ path });
      expect(Object.keys(loaded.profiles)).toEqual([
        "default",
        "__proto__",
        "constructor",
        'a"b\\c\n',
      ]);
      for (const name of Object.keys(profiles)) {
        expect(Object.hasOwn(loaded.profiles, name)).toBe(true);
        expect(loaded.profiles[name]).toEqual(budget);
        expect(Object.hasOwn(loaded.profileProvenance, name)).toBe(true);
        expect(loaded.profileProvenance[name]).toBe("declared");
      }
      expect(Object.getPrototypeOf(loaded.profiles)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(loaded.profileProvenance)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).routes).toBeUndefined();
    });
  });

  test("DW4 unknown profile labels are reference-unknown at the entry", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: { budget: { description: "Subset.", routes: [labelB, "unknown"] } },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("reference-unknown");
      expect(error.problems).toEqual([
        {
          code: "reference-unknown",
          field: '$["profiles"]["budget"]["routes"][1]',
          message: 'the profile route "unknown" is not declared in the routes built from models',
          fix: 'Add a route producing "unknown" to models, or remove the label from the profile.',
        },
      ]);
    });
  });

  const invalidProfiles = [
    {
      name: "profiles not an object",
      profiles: [],
      field: '$["profiles"]',
      message: 'the field "profiles" must be a JSON object keyed by profile name',
      fix: "Replace profiles with a JSON object keyed by profile name.",
    },
    {
      name: "profile not an object",
      profiles: { budget: false },
      field: '$["profiles"]["budget"]',
      message: 'the profile "budget" must be a JSON object',
      fix: "Replace the profile with a JSON object with description and routes.",
    },
    {
      name: "description missing",
      profiles: { budget: { routes: [] } },
      field: '$["profiles"]["budget"]["description"]',
      message: 'the required field "description" is missing',
      fix: 'Add a "description" string.',
    },
    {
      name: "routes missing",
      profiles: { budget: { description: "Subset." } },
      field: '$["profiles"]["budget"]["routes"]',
      message: 'the profile "budget" is missing the required field "routes"',
      fix: "Add a routes array of route labels; an empty array is valid.",
    },
    {
      name: "description wrong type",
      profiles: { budget: { ...budget, description: 1 } },
      field: '$["profiles"]["budget"]["description"]',
      message: 'the profile field "description" must be a string',
      fix: 'Set "description" to a string; one line is the convention.',
    },
    {
      name: "routes wrong type",
      profiles: { budget: { ...budget, routes: false } },
      field: '$["profiles"]["budget"]["routes"]',
      message: "the profile routes field must be an array of strings",
      fix: "Set routes to an array of explicit route labels.",
    },
    {
      name: "route entry wrong type",
      profiles: { budget: { ...budget, routes: [1] } },
      field: '$["profiles"]["budget"]["routes"][0]',
      message: "a profile route entry must be a string",
      fix: "Set the entry to a route label built from models, or remove the entry.",
    },
    {
      name: "DW4 duplicate membership",
      profiles: { budget: { ...budget, routes: [labelA, labelA] } },
      field: '$["profiles"]["budget"]["routes"]',
      message: `the profile routes contain the label "${labelA}" more than once`,
      fix: `Remove the duplicate label "${labelA}" from the profile routes.`,
    },
    {
      name: "DW4 empty profile name",
      profiles: { "": budget },
      field: '$["profiles"][""]',
      message: "a profile name must not be empty",
      fix: "Give the profile a non-empty name.",
    },
    {
      name: "DW4 unknown field",
      profiles: { budget: { ...budget, surprise: true } },
      field: '$["profiles"]["budget"]["surprise"]',
      message: 'the field "surprise" is not part of a format 1 profile',
      fix: "Remove the field; a profile accepts only description, routes and gaps.",
    },
  ];
  test.each(invalidProfiles)(
    "$name has a curated registry-invalid problem and fails schema validation",
    async ({ profiles, field, message, fix }) => {
      await withTempDir((dir) => {
        const value = { ...registry, profiles };
        const path = writeJson(dir, "registry.json", value);
        const before = readFileSync(path);
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.code).toBe("registry-invalid");
        expect(error.problems).toEqual([{ code: "registry-invalid", field, message, fix }]);
        expect(validate(value)).toBe(false);
        expect(readFileSync(path)).toEqual(before);
      });
    },
  );

  test.each([
    { profiles: null, field: '$["profiles"]' },
    { profiles: { budget: null }, field: '$["profiles"]["budget"]' },
    {
      profiles: { budget: { ...budget, description: null } },
      field: '$["profiles"]["budget"]["description"]',
    },
    {
      profiles: { budget: { ...budget, routes: null } },
      field: '$["profiles"]["budget"]["routes"]',
    },
    {
      profiles: { budget: { ...budget, routes: [null] } },
      field: '$["profiles"]["budget"]["routes"][0]',
    },
  ])("null at $field remains registry-invalid", async ({ profiles, field }) => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", { ...registry, profiles });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(error.problems.map((problem) => problem.field)).toEqual([field]);
    });
  });

  test("profile faults collect beside model shape, duplicate labels and other references", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 1,
        models: { "model-a": { family: 1, routes: [routeA, routeA] } },
        profiles: { budget: { description: 1, routes: [labelA, "unknown", 1] } },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(error.problems.map(({ code, field }) => ({ code, field }))).toEqual([
        { code: "registry-invalid", field: '$["models"]["model-a"]["family"]' },
        { code: "registry-invalid", field: '$["profiles"]["budget"]["description"]' },
        { code: "registry-invalid", field: '$["profiles"]["budget"]["routes"][2]' },
        { code: "label-duplicate", field: '$["models"]["model-a"]["routes"][1]' },
        { code: "reference-unknown", field: '$["profiles"]["budget"]["routes"][1]' },
      ]);
    });
  });

  test("unreadable models skips profile reference checks but readable empty models does not", async () => {
    await withTempDir((dir) => {
      for (const models of [null, [], false, undefined]) {
        const path = writeJson(dir, "registry.json", {
          format: 1,
          models,
          profiles: { budget: { description: "Subset.", routes: ["unknown"] } },
        });
        const error = catchRegistryError(() => loadRegistry({ path }));
        expect(error.problems.map(({ code, field }) => ({ code, field }))).toEqual([
          { code: "registry-invalid", field: '$["models"]' },
        ]);
      }
      const path = writeJson(dir, "registry.json", {
        format: 1,
        models: {},
        profiles: { budget: { description: "Subset.", routes: ["unknown"] } },
      });
      expect(catchRegistryError(() => loadRegistry({ path })).code).toBe("reference-unknown");
    });
  });

  test("readable profile references are checked even when their description is missing", async () => {
    await withTempDir((dir) => {
      const name = 'a"b\\c\n';
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: { [name]: { routes: ["constructor", "__proto__"] } },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.problems.map(({ code, field }) => ({ code, field }))).toEqual([
        {
          code: "registry-invalid",
          field: `$["profiles"][${JSON.stringify(name)}]["description"]`,
        },
        { code: "reference-unknown", field: `$["profiles"][${JSON.stringify(name)}]["routes"][0]` },
        { code: "reference-unknown", field: `$["profiles"][${JSON.stringify(name)}]["routes"][1]` },
      ]);
    });
  });
});
