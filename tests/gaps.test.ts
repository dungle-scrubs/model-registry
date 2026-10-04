import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { loadRegistry } from "../src/index.js";
import { AJV_OPTIONS } from "../src/validate.js";
import {
  catchRegistryError,
  runBuiltCli,
  schemaPath,
  sha256Hex,
  withTempDir,
  writeJson,
} from "./helpers.js";

const route = { harness: "harness-x", modelId: "model-id-a", hosted: false };
const label = "model-a@harness-x";
const registry = {
  format: 1,
  ratings: { coding: "Writes and changes code." },
  capabilities: { browser: "Drives a browser." },
  models: { "model-a": { family: "family-a", routes: [route] } },
};
const ratingGap = { rating: "coding", accepts: 7, reason: "This set reaches coding 7." };
const capabilityGap = { capability: "browser", reason: "This set has no browser route." };
const budget = { description: "Only a subset.", routes: [label] };
const validate = new Ajv2020(AJV_OPTIONS).compile(JSON.parse(readFileSync(schemaPath, "utf8")));

describe("profile gaps", () => {
  test("DW1 gaps of both forms load in written order and the file stays unchanged", async () => {
    await withTempDir((dir) => {
      const value = {
        ...registry,
        profiles: { budget: { ...budget, gaps: [ratingGap, capabilityGap] } },
      };
      const path = writeJson(dir, "registry.json", value);
      const before = readFileSync(path);
      const loaded = loadRegistry({ path });
      expect(Object.keys(loaded.profiles)).toEqual(["default", "budget"]);
      expect(loaded.profileProvenance).toEqual({ default: "implicit", budget: "declared" });
      expect(loaded.profiles.budget?.description).toBe("Only a subset.");
      expect(loaded.profiles.budget?.routes).toEqual([label]);
      expect(loaded.profiles.budget?.gaps).toEqual([ratingGap, capabilityGap]);
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

  test("DW1 absent gaps leave the profile without a gaps key; written empty gaps load as []", async () => {
    await withTempDir((dir) => {
      const plain = writeJson(dir, "plain.json", { ...registry, profiles: { budget } });
      const loadedPlain = loadRegistry({ path: plain });
      expect(loadedPlain.profiles.budget).toEqual(budget);
      expect(Object.hasOwn(loadedPlain.profiles.budget ?? {}, "gaps")).toBe(false);
      const empty = writeJson(dir, "empty.json", {
        ...registry,
        profiles: { budget: { ...budget, gaps: [] } },
      });
      const loadedEmpty = loadRegistry({ path: empty });
      expect(loadedEmpty.profiles.budget?.description).toBe("Only a subset.");
      expect(loadedEmpty.profiles.budget?.gaps).toEqual([]);
      expect(Object.hasOwn(loadedEmpty.profiles.budget ?? {}, "gaps")).toBe(true);
    });
  });

  test("the implicit default never carries a gaps key", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: { budget: { ...budget, gaps: [ratingGap] } },
      });
      const loaded = loadRegistry({ path });
      expect(loaded.profiles.default).toEqual({ routes: [label] });
      expect(Object.keys(loaded.profiles.default ?? {})).toEqual(["routes"]);
      expect(Object.hasOwn(loaded.profiles.default ?? {}, "gaps")).toBe(false);
    });
  });

  const invalidGaps = [
    {
      name: "DW2 gaps not an array",
      gaps: {},
      field: '$["profiles"]["budget"]["gaps"]',
      message: "the profile gaps field must be an array of gap records",
      fix: "Set gaps to an array of accepted gap records.",
    },
    {
      name: "DW2 gap not an object",
      gaps: [5],
      field: '$["profiles"]["budget"]["gaps"][0]',
      message: "a profile gap must be a JSON object",
      fix: "Replace the gap with a JSON object naming a rating or a capability and a reason.",
    },
    {
      name: "DW2 both rating and capability",
      gaps: [{ rating: "coding", accepts: 7, capability: "browser", reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]',
      message: 'a profile gap must name exactly one of "rating" or "capability"',
      fix: 'Keep either "rating" with "accepts" or "capability", and remove the other fields.',
    },
    {
      name: "DW2 neither rating nor capability",
      gaps: [{ reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]',
      message: 'a profile gap must name exactly one of "rating" or "capability"',
      fix: 'Give the gap either a "rating" with "accepts" or a "capability".',
    },
    {
      name: "DW2 rating without accepts",
      gaps: [{ rating: "coding", reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]["accepts"]',
      message: 'a rating gap is missing the required field "accepts"',
      fix: 'Add an "accepts" integer from 1 to 10 naming the accepted ceiling.',
    },
    {
      name: "DW2 accepts beside capability",
      gaps: [{ capability: "browser", accepts: 7, reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]["accepts"]',
      message: 'the field "accepts" is only valid beside a "rating" gap',
      fix: 'Remove "accepts", or give the gap a "rating" to cap.',
    },
    {
      name: "DW2 accepts without either variant",
      gaps: [{ accepts: 7, reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]["accepts"]',
      message: 'the field "accepts" is only valid beside a "rating" gap',
      fix: 'Remove "accepts", or give the gap a "rating" to cap.',
    },
    {
      name: "DW2 unknown field on a gap",
      gaps: [{ ...ratingGap, surprise: true }],
      field: '$["profiles"]["budget"]["gaps"][0]["surprise"]',
      message: 'the field "surprise" is not part of a format 1 profile gap',
      fix: "Remove the field; a gap accepts only rating, accepts, capability and reason.",
    },
    {
      name: "DW2 accepts not an integer",
      gaps: [{ rating: "coding", accepts: 7.5, reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]["accepts"]',
      message: 'the gap field "accepts" must be an integer from 1 to 10',
      fix: 'Set "accepts" to an integer from 1 to 10 naming the accepted ceiling.',
    },
    {
      name: "DW2 accepts below 1",
      gaps: [{ rating: "coding", accepts: 0, reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]["accepts"]',
      message: 'the gap field "accepts" must be an integer from 1 to 10',
      fix: 'Set "accepts" to an integer from 1 to 10 naming the accepted ceiling.',
    },
    {
      name: "DW2 accepts above 10",
      gaps: [{ rating: "coding", accepts: 11, reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]["accepts"]',
      message: 'the gap field "accepts" must be an integer from 1 to 10',
      fix: 'Set "accepts" to an integer from 1 to 10 naming the accepted ceiling.',
    },
    {
      name: "DW2 reason missing",
      gaps: [{ rating: "coding", accepts: 7 }],
      field: '$["profiles"]["budget"]["gaps"][0]["reason"]',
      message: 'the gap is missing the required field "reason"',
      fix: 'Add a non-empty "reason" string.',
    },
    {
      name: "reason missing on a capability gap",
      gaps: [{ capability: "browser" }],
      field: '$["profiles"]["budget"]["gaps"][0]["reason"]',
      message: 'the gap is missing the required field "reason"',
      fix: 'Add a non-empty "reason" string.',
    },
    {
      name: "DW2 reason empty",
      gaps: [{ rating: "coding", accepts: 7, reason: "" }],
      field: '$["profiles"]["budget"]["gaps"][0]["reason"]',
      message: 'the gap field "reason" must be a non-empty string',
      fix: 'Set "reason" to a non-empty string.',
    },
    {
      name: "reason not a string",
      gaps: [{ rating: "coding", accepts: 7, reason: 5 }],
      field: '$["profiles"]["budget"]["gaps"][0]["reason"]',
      message: 'the gap field "reason" must be a non-empty string',
      fix: 'Set "reason" to a non-empty string.',
    },
    {
      name: "rating not a string",
      gaps: [{ rating: 7, accepts: 7, reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]["rating"]',
      message: 'the gap field "rating" must be a string',
      fix: 'Set "rating" to a rating name declared in the ratings section.',
    },
    {
      name: "capability not a string",
      gaps: [{ capability: 7, reason: "Placeholder." }],
      field: '$["profiles"]["budget"]["gaps"][0]["capability"]',
      message: 'the gap field "capability" must be a string',
      fix: 'Set "capability" to a capability name declared in the capabilities section.',
    },
  ];
  test.each(invalidGaps)(
    "$name has one curated registry-invalid problem and fails schema validation",
    async ({ gaps, field, message, fix }) => {
      await withTempDir((dir) => {
        const value = { ...registry, profiles: { budget: { ...budget, gaps } } };
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
    { gaps: null, field: '$["profiles"]["budget"]["gaps"]' },
    { gaps: [null], field: '$["profiles"]["budget"]["gaps"][0]' },
    {
      gaps: [{ ...ratingGap, reason: null }],
      field: '$["profiles"]["budget"]["gaps"][0]["reason"]',
    },
    {
      gaps: [{ ...ratingGap, accepts: null }],
      field: '$["profiles"]["budget"]["gaps"][0]["accepts"]',
    },
  ])("null at $field remains registry-invalid", async ({ gaps, field }) => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: { budget: { ...budget, gaps } },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(error.problems.map((problem) => problem.field)).toEqual([field]);
    });
  });

  test("DW2 a duplicate gap target is registry-invalid at the later gap, naming the earlier index", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: {
          budget: {
            ...budget,
            gaps: [ratingGap, { rating: "coding", accepts: 8, reason: "Second record." }],
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("registry-invalid");
      expect(error.problems).toEqual([
        {
          code: "registry-invalid",
          field: '$["profiles"]["budget"]["gaps"][1]["rating"]',
          message:
            'the profile "budget" records the rating "coding" as an accepted gap twice; the earlier gap is at index 0',
          fix: 'Remove the duplicate gap, or keep a single record for the rating "coding".',
        },
      ]);
    });
  });

  test("DW2 a duplicate capability target fails the same way", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: {
          budget: {
            ...budget,
            gaps: [capabilityGap, { capability: "browser", reason: "Second record." }],
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.problems).toEqual([
        {
          code: "registry-invalid",
          field: '$["profiles"]["budget"]["gaps"][1]["capability"]',
          message:
            'the profile "budget" records the capability "browser" as an accepted gap twice; the earlier gap is at index 0',
          fix: 'Remove the duplicate gap, or keep a single record for the capability "browser".',
        },
      ]);
    });
  });

  test("identical whole records report one problem, and a third copy names the first index again", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: { budget: { ...budget, gaps: [ratingGap, ratingGap, ratingGap] } },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.problems).toEqual([
        {
          code: "registry-invalid",
          field: '$["profiles"]["budget"]["gaps"][1]["rating"]',
          message:
            'the profile "budget" records the rating "coding" as an accepted gap twice; the earlier gap is at index 0',
          fix: 'Remove the duplicate gap, or keep a single record for the rating "coding".',
        },
        {
          code: "registry-invalid",
          field: '$["profiles"]["budget"]["gaps"][2]["rating"]',
          message:
            'the profile "budget" records the rating "coding" as an accepted gap twice; the earlier gap is at index 0',
          fix: 'Remove the duplicate gap, or keep a single record for the rating "coding".',
        },
      ]);
    });
  });

  test("a rating and a capability sharing a name are different targets; profiles may repeat a target", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        capabilities: { browser: "Drives a browser.", coding: "Writes code by name too." },
        profiles: {
          budget: {
            ...budget,
            gaps: [ratingGap, { capability: "coding", reason: "No coding-capable route." }],
          },
          spare: { description: "Another subset.", routes: [label], gaps: [ratingGap] },
        },
      });
      const loaded = loadRegistry({ path });
      expect(loaded.profiles.budget?.gaps).toEqual([
        ratingGap,
        { capability: "coding", reason: "No coding-capable route." },
      ]);
      expect(loaded.profiles.spare?.gaps).toEqual([ratingGap]);
    });
  });

  test("DW2 an undeclared rating or capability in a gap is reference-unknown at the field", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: {
          budget: {
            ...budget,
            gaps: [
              { rating: "taste", accepts: 5, reason: "Placeholder." },
              { capability: "tools", reason: "Placeholder." },
            ],
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("reference-unknown");
      expect(error.problems).toEqual([
        {
          code: "reference-unknown",
          field: '$["profiles"]["budget"]["gaps"][0]["rating"]',
          message: 'the profile gap rating "taste" is not declared in the ratings section',
          fix: 'Add "taste" to the ratings section, or remove the gap from the profile.',
        },
        {
          code: "reference-unknown",
          field: '$["profiles"]["budget"]["gaps"][1]["capability"]',
          message: 'the profile gap capability "tools" is not declared in the capabilities section',
          fix: 'Add "tools" to the capabilities section, or remove the gap from the profile.',
        },
      ]);
    });
  });

  test("cost is not exempt: a rating gap naming cost needs a ratings entry", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: {
          budget: { ...budget, gaps: [{ rating: "cost", accepts: 5, reason: "Placeholder." }] },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.code).toBe("reference-unknown");
      expect(error.problems.map((problem) => problem.field)).toEqual([
        '$["profiles"]["budget"]["gaps"][0]["rating"]',
      ]);
    });
  });

  test("an absent section declares nothing; an unreadable section skips the check", async () => {
    await withTempDir((dir) => {
      const absent = writeJson(dir, "absent.json", {
        format: 1,
        ratings: { coding: "Writes and changes code." },
        models: registry.models,
        profiles: { budget: { ...budget, gaps: [capabilityGap] } },
      });
      const absentError = catchRegistryError(() => loadRegistry({ path: absent }));
      expect(absentError.code).toBe("reference-unknown");
      expect(absentError.problems.map(({ code, field }) => ({ code, field }))).toEqual([
        { code: "reference-unknown", field: '$["profiles"]["budget"]["gaps"][0]["capability"]' },
      ]);

      const unreadable = writeJson(dir, "unreadable.json", {
        ...registry,
        ratings: [],
        profiles: { budget: { ...budget, gaps: [ratingGap] } },
      });
      const unreadableError = catchRegistryError(() => loadRegistry({ path: unreadable }));
      expect(unreadableError.problems.map((problem) => problem.field)).toEqual(['$["ratings"]']);
    });
  });

  test("gap references are checked even when models is unreadable", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 1,
        ratings: { coding: "Writes and changes code." },
        models: null,
        profiles: {
          budget: { ...budget, gaps: [{ rating: "taste", accepts: 5, reason: "Placeholder." }] },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.problems.map(({ code, field }) => ({ code, field }))).toEqual([
        { code: "registry-invalid", field: '$["models"]' },
        { code: "reference-unknown", field: '$["profiles"]["budget"]["gaps"][0]["rating"]' },
      ]);
    });
  });

  test("gap faults collect beside model shape, duplicate labels and route references", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 1,
        ratings: { coding: "Writes and changes code." },
        models: { "model-a": { family: 1, routes: [route, route] } },
        profiles: {
          budget: {
            description: "Only a subset.",
            routes: ["unknown"],
            gaps: [{ rating: "coding", reason: "No accepts." }, { reason: "" }],
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.problems.map(({ code, field }) => ({ code, field }))).toEqual([
        { code: "registry-invalid", field: '$["models"]["model-a"]["family"]' },
        { code: "registry-invalid", field: '$["profiles"]["budget"]["gaps"][0]["accepts"]' },
        { code: "registry-invalid", field: '$["profiles"]["budget"]["gaps"][1]' },
        { code: "registry-invalid", field: '$["profiles"]["budget"]["gaps"][1]["reason"]' },
        { code: "label-duplicate", field: '$["models"]["model-a"]["routes"][1]' },
        { code: "reference-unknown", field: '$["profiles"]["budget"]["routes"][0]' },
      ]);
    });
  });

  test("readable gap references are checked even when the profile description is missing", async () => {
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", {
        ...registry,
        profiles: {
          budget: {
            routes: [label],
            gaps: [{ rating: "taste", accepts: 5, reason: "Placeholder." }],
          },
        },
      });
      const error = catchRegistryError(() => loadRegistry({ path }));
      expect(error.problems.map(({ code, field }) => ({ code, field }))).toEqual([
        { code: "registry-invalid", field: '$["profiles"]["budget"]["description"]' },
        { code: "reference-unknown", field: '$["profiles"]["budget"]["gaps"][0]["rating"]' },
      ]);
    });
  });
});
