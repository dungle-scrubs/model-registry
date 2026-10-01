import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { loadRegistry } from "../src/load-registry.js";
import type { Model, RegistryFile, Route } from "../src/types.js";
import { AJV_OPTIONS } from "../src/validate.js";
import {
  catchRegistryError,
  deferredProperties,
  examplePath,
  repoRoot,
  schemaPath,
  supportedProperties,
  withTempDir,
} from "./helpers.js";

const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
  $schema?: string;
  properties: Record<string, unknown>;
  additionalProperties: unknown;
  $defs: {
    model: { properties: Record<string, unknown> };
    route: { properties: Record<string, unknown> };
  };
};

const validate = new Ajv2020(AJV_OPTIONS).compile(schema);

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

describe("registry.schema.json", () => {
  test("is draft 2020-12", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  test("validates the published example", () => {
    const example = JSON.parse(readFileSync(examplePath, "utf8"));
    expect(validate(example)).toBe(true);
  });

  test("accepts every supported optional property in one registry", () => {
    const registry: RegistryFile = { format: 1, models: { "model-a": fullModel } };
    expect(validate(registry)).toBe(true);
  });

  test("property tables match the TypeScript types", () => {
    expect(supportedProperties(schema.properties)).toEqual(["format", "models"]);
    expect(deferredProperties(schema.properties)).toEqual([
      "calibration",
      "capabilities",
      "meters",
      "ratings",
    ]);
    expect(supportedProperties(schema.$defs.model.properties)).toEqual([
      "family",
      "notes",
      "routes",
    ]);
    expect(deferredProperties(schema.$defs.model.properties)).toEqual([
      "fixedEffort",
      "maxEffort",
      "ratings",
    ]);
    expect(supportedProperties(schema.$defs.route.properties)).toEqual([
      "cost",
      "harness",
      "hosted",
      "modelId",
      "notes",
      "privacyEligible",
      "provider",
      "rateLimitRpm",
      "responseSeconds",
    ]);
    expect(deferredProperties(schema.$defs.route.properties)).toEqual(["capabilities", "meter"]);
  });

  test("cost range mirrors the rating union", () => {
    const registryWithCost = (cost: number): unknown => ({
      format: 1,
      models: { "model-a": { ...fullModel, routes: [{ ...fullRoute, cost }] } },
    });
    expect(validate(registryWithCost(1))).toBe(true);
    expect(validate(registryWithCost(10))).toBe(true);
    expect(validate(registryWithCost(0))).toBe(false);
    expect(validate(registryWithCost(11))).toBe(false);
  });

  test("rejects wrong types, null, missing required fields and unknown fields", () => {
    const registry = (models: unknown): unknown => ({ format: 1, models });
    const model = (patch: Record<string, unknown>): unknown => ({ ...fullModel, ...patch });
    const route = (patch: Record<string, unknown>): unknown => ({ ...fullRoute, ...patch });

    const negatives: Array<{ name: string; value: unknown }> = [
      {
        name: "harness wrong type",
        value: registry({ "model-a": model({ routes: [route({ harness: 5 })] }) }),
      },
      {
        name: "modelId wrong type",
        value: registry({ "model-a": model({ routes: [route({ modelId: 5 })] }) }),
      },
      {
        name: "provider wrong type",
        value: registry({ "model-a": model({ routes: [route({ provider: 5 })] }) }),
      },
      {
        name: "hosted wrong type",
        value: registry({ "model-a": model({ routes: [route({ hosted: "true" })] }) }),
      },
      {
        name: "hosted null",
        value: registry({ "model-a": model({ routes: [route({ hosted: null })] }) }),
      },
      { name: "notes null", value: registry({ "model-a": model({ notes: null }) }) },
      {
        name: "route notes null",
        value: registry({ "model-a": model({ routes: [route({ notes: null })] }) }),
      },
      {
        name: "privacyEligible wrong type",
        value: registry({ "model-a": model({ routes: [route({ privacyEligible: 1 })] }) }),
      },
      { name: "family wrong type", value: registry({ "model-a": model({ family: 5 }) }) },
      { name: "family missing", value: registry({ "model-a": { notes: "x", routes: [] } }) },
      { name: "routes missing", value: registry({ "model-a": { family: "family-a" } }) },
      { name: "routes wrong type", value: registry({ "model-a": model({ routes: {} }) }) },
      { name: "route not an object", value: registry({ "model-a": model({ routes: ["x"] }) }) },
      { name: "model not an object", value: registry({ "model-a": "x" }) },
      {
        name: "harness missing",
        value: registry({ "model-a": model({ routes: [{ modelId: "m", hosted: true }] }) }),
      },
      {
        name: "modelId missing",
        value: registry({ "model-a": model({ routes: [{ harness: "h", hosted: true }] }) }),
      },
      {
        name: "hosted missing",
        value: registry({ "model-a": model({ routes: [{ harness: "h", modelId: "m" }] }) }),
      },
      { name: "unknown model field", value: registry({ "model-a": model({ surprise: 1 }) }) },
      {
        name: "unknown route field",
        value: registry({ "model-a": model({ routes: [route({ surprise: 1 })] }) }),
      },
      { name: "models missing", value: { format: 1 } },
      { name: "format missing", value: { models: {} } },
      { name: "format wrong value", value: { format: 2, models: {} } },
      { name: "format wrong type", value: { format: "1", models: {} } },
      {
        name: "rate negative",
        value: registry({ "model-a": model({ routes: [route({ rateLimitRpm: -1 })] }) }),
      },
      {
        name: "rate string not coerced",
        value: registry({ "model-a": model({ routes: [route({ rateLimitRpm: "5" })] }) }),
      },
      {
        name: "response negative",
        value: registry({ "model-a": model({ routes: [route({ responseSeconds: -0.5 })] }) }),
      },
    ];
    for (const negative of negatives) {
      expect(validate(negative.value), negative.name).toBe(false);
    }
  });

  test("rejects the deferred owned fields", () => {
    const withModels = (models: unknown): unknown => ({ format: 1, models });
    const negatives: Array<{ name: string; value: unknown }> = [
      { name: "top-level ratings", value: { format: 1, models: {}, ratings: { coding: "x" } } },
      {
        name: "top-level capabilities",
        value: { format: 1, models: {}, capabilities: { browser: "x" } },
      },
      {
        name: "top-level meters",
        value: { format: 1, models: {}, meters: { plan: { spendToZero: true } } },
      },
      { name: "top-level calibration", value: { format: 1, models: {}, calibration: {} } },
      {
        name: "model ratings",
        value: withModels({ "model-a": { ...fullModel, ratings: { coding: 5 } } }),
      },
      {
        name: "model maxEffort",
        value: withModels({ "model-a": { ...fullModel, maxEffort: "high" } }),
      },
      {
        name: "model fixedEffort",
        value: withModels({ "model-a": { ...fullModel, fixedEffort: "low" } }),
      },
      {
        name: "route capabilities",
        value: withModels({
          "model-a": { ...fullModel, routes: [{ ...fullRoute, capabilities: ["browser"] }] },
        }),
      },
      {
        name: "route meter",
        value: withModels({
          "model-a": { ...fullModel, routes: [{ ...fullRoute, meter: "plan" }] },
        }),
      },
    ];
    for (const negative of negatives) {
      expect(validate(negative.value), negative.name).toBe(false);
    }
  });

  test("accepts foreign sections, including deeply nested non-null JSON", () => {
    const value = {
      format: 1,
      models: {},
      router: { unrecognisedRouterField: ["placeholder", { enabled: true }] },
      "extension-a": { values: [1, false, "placeholder", { deep: { deeper: [0] } }] },
    };
    expect(validate(value)).toBe(true);

    expect(validate({ format: 1, models: {}, router: { keys: ["a", null] } })).toBe(false);
  });

  test("foreign sections accept any property name a JSON file can carry", () => {
    // additionalProperties with the recursive JSON definition admits every
    // name, including line terminators that a pattern such as .* cannot match.
    const value = JSON.parse(
      '{"format":1,"models":{},"extension\\nname":true,"a\\"b":[1],"c\\\\d":{"e":true},"\\u00e9":0,"":false}',
    );
    expect(validate(value)).toBe(true);
  });

  test("the loader and the schema agree on every fixture", async () => {
    await withTempDir(async (dir) => {
      const cases: Array<{
        name: string;
        // Raw JSON text: JSON.stringify would rewrite Infinity as null.
        content: string;
        schemaValid: boolean;
        loaderCode?: string;
        loaderField?: string;
        section?: [string, unknown];
      }> = [
        {
          name: "numeric overflow in a foreign section",
          content: '{"format":1,"models":{},"router":{"value":1e400}}',
          schemaValid: false,
          loaderCode: "registry-invalid",
          loaderField: '$["router"]["value"]',
        },
        {
          name: "numeric overflow deep in a foreign section",
          content: '{"format":1,"models":{},"router":{"v":[1,{"w":1e400}]}}',
          schemaValid: false,
          loaderCode: "registry-invalid",
          loaderField: '$["router"]["v"][1]["w"]',
        },
        {
          name: "numeric overflow in an owned metric",
          content:
            '{"format":1,"models":{"model-a":{"family":"family-a","routes":[{"harness":"harness-x","modelId":"model-id-a","hosted":false,"rateLimitRpm":1e400}]}}}',
          schemaValid: false,
          loaderCode: "registry-invalid",
          loaderField: '$["models"]["model-a"]["routes"][0]["rateLimitRpm"]',
        },
        {
          name: "numeric overflow in cost",
          content:
            '{"format":1,"models":{"model-a":{"family":"family-a","routes":[{"harness":"harness-x","modelId":"model-id-a","hosted":false,"cost":1e400}]}}}',
          schemaValid: false,
          loaderCode: "registry-invalid",
          loaderField: '$["models"]["model-a"]["routes"][0]["cost"]',
        },
        {
          name: "null in a foreign section",
          content: '{"format":1,"models":{},"router":{"keys":["a",null]}}',
          schemaValid: false,
          loaderCode: "registry-invalid",
          loaderField: '$["router"]["keys"][1]',
        },
        {
          name: "null in a top-level foreign section",
          content: '{"format":1,"models":{},"extension":null}',
          schemaValid: false,
          loaderCode: "registry-invalid",
          loaderField: '$["extension"]',
        },
        {
          name: "a foreign section with the review's fixture shape",
          content: '{"format":1,"models":{},"router":{"enabled":true}}',
          schemaValid: true,
          section: ["router", { enabled: true }],
        },
        {
          name: "a finite large number in a foreign section",
          content: '{"format":1,"models":{},"router":{"value":1e308}}',
          schemaValid: true,
          section: ["router", { value: 1e308 }],
        },
      ];
      for (const testCase of cases) {
        const path = join(dir, `${testCase.name.replace(/\W+/g, "-")}.json`);
        writeFileSync(path, testCase.content);
        expect(validate(JSON.parse(testCase.content)), testCase.name).toBe(testCase.schemaValid);
        if (testCase.schemaValid) {
          const loaded = loadRegistry({ path });
          const [sectionName, sectionValue] = testCase.section ?? [null, null];
          if (sectionName !== null) {
            expect(loaded.sections[sectionName], testCase.name).toEqual(sectionValue);
          }
        } else {
          const error = catchRegistryError(() => loadRegistry({ path }));
          expect(error.code, testCase.name).toBe(testCase.loaderCode);
          expect(
            error.problems.some((problem) => problem.field === testCase.loaderField),
            `${testCase.name}: ${JSON.stringify(error.problems)}`,
          ).toBe(true);
        }
      }
    });
  });

  test("the example and schema agree on the file location this package exports", () => {
    const packageJson = JSON.parse(readFileSync(`${repoRoot}/package.json`, "utf8")) as {
      exports: Record<string, string | { types?: string; import?: string }>;
    };
    expect(packageJson.exports["./registry.schema.json"]).toBe("./registry.schema.json");
    expect(packageJson.exports["./examples/registry.json"]).toBe("./examples/registry.json");
  });
});
