import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadRegistry } from "../src/index.js";
import { repoRoot, runBuiltCli } from "./helpers.js";

const root = join(repoRoot, "examples", "profile-walkthrough");

interface Band {
  at: number;
  score: number;
}

interface Benchmark {
  source: string;
  direction: "higher" | "lower";
  version: string;
  bands: Band[];
}

interface Figure {
  value: number;
  read: string;
  effort: string;
}

interface Calibration {
  benchmarks: Record<string, Benchmark>;
  feeds: Record<string, string[]>;
  handSet: string[];
  figures: Record<string, Record<string, Figure>>;
  overrides: Array<Record<string, unknown>>;
}

interface Route {
  hosted?: boolean;
  [key: string]: unknown;
}

interface WalkthroughRegistry {
  calibration: Calibration;
  models: Record<
    string,
    { ratings?: Record<string, number>; maxEffort?: string; routes?: Route[] }
  >;
  meters: Record<string, Record<string, unknown>>;
  profiles: Record<string, { routes: string[] }>;
  tasks: Record<string, unknown>;
}

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

function readRegistry(): WalkthroughRegistry {
  return JSON.parse(readFileSync(join(root, "registry.json"), "utf8")) as WalkthroughRegistry;
}

function readRegistryFile(name: string): WalkthroughRegistry {
  return JSON.parse(readFileSync(join(root, name), "utf8")) as WalkthroughRegistry;
}

function readReadme(): string {
  return readFileSync(join(root, "README.md"), "utf8");
}

/** Text with runs of whitespace collapsed to single spaces, so assertions
 * survive the README's line wrapping. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * The RFC's decile band rule, as an independent oracle: sort the n figures
 * worst to best by direction; the figure of rank r sits in tenth
 * ceil(10 * r / n); the band for score k has `at` = the worst figure in
 * tenth k. Bands are written best first; a tenth with no figure gives no
 * band; when two bands share an `at`, the higher score survives.
 */
function decileBands(values: readonly number[], direction: "higher" | "lower"): Band[] {
  const worstToBest = [...values].sort((a, b) => (direction === "higher" ? a - b : b - a));
  const n = worstToBest.length;
  const atByScore = new Map<number, number>();
  for (let rank = 1; rank <= n; rank += 1) {
    const tenth = Math.ceil((10 * rank) / n);
    if (!atByScore.has(tenth)) {
      atByScore.set(tenth, worstToBest[rank - 1] as number);
    }
  }
  const bands: Band[] = [];
  const seenAt = new Set<number>();
  for (let score = 10; score >= 1; score -= 1) {
    const at = atByScore.get(score);
    if (at === undefined || seenAt.has(at)) {
      continue;
    }
    seenAt.add(at);
    bands.push({ at, score });
  }
  return bands;
}

describe("the profile walkthrough", () => {
  test("DW8 every snapshot has exactly the contract fields, a safe filename, and a revision on the catalog read", () => {
    for (const dirName of ["lists", "lists-before-rebuild"]) {
      const names = readdirSync(join(root, dirName));
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(name, `${dirName}/${name}`).toMatch(/^[a-z0-9-]+\.json$/);
        const value = JSON.parse(readFileSync(join(root, dirName, name), "utf8")) as Record<
          string,
          unknown
        >;
        const expected = [
          "method",
          "modelIds",
          "read",
          "scope",
          "source",
          ...(value.revision === undefined ? [] : ["revision"]),
        ];
        expect(Object.keys(value).sort(), `${dirName}/${name} fields`).toEqual(
          [...expected].sort(),
        );
        for (const field of ["source", "method", "read", "scope"]) {
          expect(typeof value[field], `${dirName}/${name} ${field}`).toBe("string");
          expect((value[field] as string).length).toBeGreaterThan(0);
        }
        expect(value.read, `${dirName}/${name} read`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Array.isArray(value.modelIds), `${dirName}/${name} modelIds`).toBe(true);
        for (const id of value.modelIds as unknown[]) {
          expect(typeof id).toBe("string");
          expect((id as string).length).toBeGreaterThan(0);
        }
        const isCatalog = name.includes("catalog") || String(value.source).includes("catalog");
        if (isCatalog) {
          expect(typeof value.revision, `${dirName}/${name} revision`).toBe("string");
          expect((value.revision as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("DW8 the rebuild diff the README shows equals the before and after snapshot difference", () => {
    const readme = readReadme();
    const before = JSON.parse(
      readFileSync(join(root, "lists-before-rebuild", "aggregator-a.json"), "utf8"),
    ) as { modelIds: string[] };
    const after = JSON.parse(readFileSync(join(root, "lists", "aggregator-a.json"), "utf8")) as {
      modelIds: string[];
    };
    const match = readme.match(
      /rebuild diff - aggregator-a[^\n]*\nremoved: ([^\n]+)\nadded: ([^\n]+)/,
    );
    if (match === null) {
      throw new Error("the walkthrough README does not show the aggregator-a rebuild diff block");
    }
    const listed = (part: string) =>
      part
        .split(", ")
        .filter((id) => id !== "none")
        .sort();
    expect(listed(match[1] as string)).toEqual(
      before.modelIds.filter((id) => !after.modelIds.includes(id)).sort(),
    );
    expect(listed(match[2] as string)).toEqual(
      after.modelIds.filter((id) => !before.modelIds.includes(id)).sort(),
    );
    // The departed model's route is flagged for removal, never silently removed.
    expect(readme).toContain("flagged for removal");
    expect(readme).toContain("model-c@harness-z/aggregator-a");
  });

  test("DW8 the walkthrough registry passes model-registry check and loads with the declared profile", () => {
    const registryPath = join(root, "registry.json");
    const result = runBuiltCli(["check", "--registry", registryPath]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const record = JSON.parse(result.stdout) as { format: number; digest: string };
    expect(record.format).toBe(1);
    expect(record.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const loaded = loadRegistry({ path: registryPath });
    expect(loaded.profileProvenance["builder-pool"]).toBe("declared");
    const profile = loaded.profiles["builder-pool"];
    expect(profile?.routes.length).toBeGreaterThan(0);
    for (const label of profile?.routes ?? []) {
      expect(loaded.routes[label]).toBeDefined();
    }
  });

  test("DW8 every fed benchmark's bands equal the decile rule over its pinned read", () => {
    const registry = readRegistry();
    const fed = new Set(Object.values(registry.calibration.feeds).flat());
    expect(fed.size).toBeGreaterThan(0);
    for (const name of fed) {
      const read = JSON.parse(readFileSync(join(root, "reads", `${name}.json`), "utf8")) as {
        version: string;
        rows: Array<{ value: number }>;
      };
      const benchmark = registry.calibration.benchmarks[name];
      if (benchmark === undefined) {
        throw new Error(`the registry does not declare the fed benchmark ${name}`);
      }
      const values = read.rows.map((row) => row.value);
      expect(values.length, `${name} pinned read rows`).toBeGreaterThanOrEqual(10);
      expect(benchmark.bands, `${name} bands match the decile rule`).toEqual(
        decileBands(values, benchmark.direction),
      );
      expect(benchmark.version, `${name} records its read identity`).toBe(read.version);
    }
  });

  test("DW8 the above-cap key is in no feed and its figure sits above the model's cap; taste is hand-set", () => {
    const registry = readRegistry();
    const fed = new Set(Object.values(registry.calibration.feeds).flat());
    const aboveCap = "engines-above-cap";
    expect(Object.hasOwn(registry.calibration.benchmarks, aboveCap)).toBe(true);
    expect(fed.has(aboveCap)).toBe(false);
    const figure = registry.calibration.figures["model-b"]?.[aboveCap];
    const cap = registry.models["model-b"]?.maxEffort;
    expect(figure).toBeDefined();
    expect(cap).toBeDefined();
    if (figure !== undefined && cap !== undefined) {
      expect(EFFORT_ORDER.indexOf(figure.effort as (typeof EFFORT_ORDER)[number])).toBeGreaterThan(
        EFFORT_ORDER.indexOf(cap as (typeof EFFORT_ORDER)[number]),
      );
    }
    // No eligible figure at or below the cap: the rating stays absent, with no override.
    expect(registry.models["model-b"]?.ratings?.coding).toBeUndefined();
    expect(JSON.stringify(registry.calibration.overrides)).not.toContain('"coding"');
    // Taste stays hand-set, and its evidence key feeds nothing.
    expect(registry.calibration.handSet).toContain("taste");
    expect(Object.hasOwn(registry.calibration.feeds, "taste")).toBe(false);
    expect(fed.has("taste-evidence")).toBe(false);
  });

  test("DW8 the walkthrough stays placeholder-only and unshipped", () => {
    const texts = [
      readReadme(),
      readFileSync(join(root, "registry.json"), "utf8"),
      readFileSync(join(root, "registry-before-rebuild.json"), "utf8"),
    ];
    for (const dirName of ["lists", "lists-before-rebuild", "reads"]) {
      for (const name of readdirSync(join(root, dirName))) {
        texts.push(readFileSync(join(root, dirName, name), "utf8"));
      }
    }
    for (const [index, text] of texts.entries()) {
      expect(text, `walkthrough file ${index}`).not.toContain("Artificial Analysis");
      expect(text.toLowerCase(), `walkthrough file ${index}`).not.toContain("arena");
    }
    const registry = readRegistry();
    for (const [name, benchmark] of Object.entries(registry.calibration.benchmarks)) {
      expect(benchmark.source, `${name} source`).toContain("example.org");
    }
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      files: string[];
      exports: Record<string, string>;
    };
    expect(packageJson.files).not.toContain("examples/profile-walkthrough");
    expect(
      Object.keys(packageJson.exports).some((key) => key.includes("profile-walkthrough")),
    ).toBe(false);
  });

  test("F5 the builder asks about the catalog-suggested platform before reading it", () => {
    const readme = readReadme();
    const ask = readme.match(/^\*\*Agent:\*\*.*platform-b.*$/m);
    expect(ask).not.toBeNull();
    const askIndex = readme.indexOf(ask?.[0] ?? "");
    // The ask comes before the harness-y read that confirms platform-b's models.
    expect(readme.indexOf("lists/platform-b-harness.json")).toBeGreaterThan(askIndex);
    expect(readme).toContain("put it after aggregator-a");
    expect(flat(readme)).toContain("at the position the user gave");
    expect(readme).not.toContain("joined at discovery");
  });

  test("F6 the walkthrough states each model has one route and labels carry no ranking", () => {
    const readme = flat(readReadme());
    expect(readme).toContain("Each model here has one route");
    expect(readme).toContain("no route order to write");
    expect(readme).toContain("carries no ranking");
  });

  test("F7 the walkthrough checks confirm the reported path matches the written file", () => {
    expect(readReadme()).toContain("match the written file");
  });

  test("F8 shared values come from the user, and the proposal shows them", () => {
    const readme = readReadme();
    const registry = readRegistry();
    // The meter carries no field the transcript never supported.
    expect(registry.meters["plan-a"]).toEqual({});
    expect(registry.meters["plan-a"]).not.toHaveProperty("spendToZero");
    // Every floor level appears in the proposal's shared fact list.
    const flattened = flat(readme);
    for (const level of [
      "low coding 6 taste 4",
      "normal coding 7 taste 4",
      "high coding 8 taste 5",
    ]) {
      expect(flattened).toContain(level);
    }
    // The subscription route's cost 9 is given by the user, not invented.
    expect(readme).toMatch(/\*\*User:\*\*.*Cost 9/);
  });

  test("F9 the registry as first approved passes check and holds the departed route", () => {
    const beforePath = join(root, "registry-before-rebuild.json");
    const result = runBuiltCli(["check", "--registry", beforePath]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const loaded = loadRegistry({ path: beforePath });
    expect(loaded.profiles["builder-pool"]?.routes).toContain("model-c@harness-z/aggregator-a");
  });

  test("F9 the before and after registries differ only by model-c, its route label and its two figures", () => {
    const before = readRegistryFile("registry-before-rebuild.json");
    delete before.models["model-c"];
    const pool = before.profiles["builder-pool"];
    if (pool === undefined) {
      throw new Error("the pre-rebuild registry has no builder-pool profile");
    }
    pool.routes = pool.routes.filter((label) => label !== "model-c@harness-z/aggregator-a");
    delete before.calibration.figures["model-c"];
    delete before.calibration.figures["model-c@harness-z/aggregator-a"];
    expect(before).toEqual(readRegistry());
  });

  test("F9 every console block shows the real digest of the file it checks", () => {
    const readme = readReadme();
    const blocks = readme.match(/```console\n([\s\S]*?)```/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const seen: string[] = [];
    for (const block of blocks) {
      const lines = block.split("\n").slice(1, -1);
      for (let index = 0; index < lines.length; index += 2) {
        const file = lines[index]?.match(/--registry (\S+)/)?.[1];
        expect(file, `console command ${index}: ${lines[index]}`).toBeDefined();
        const record = JSON.parse(lines[index + 1] ?? "") as {
          digest?: string;
          registryDigest?: string;
        };
        const result = runBuiltCli(["check", "--registry", join(root, file as string)]);
        expect(result.exitCode, `check for ${file}`).toBe(0);
        const digest = (JSON.parse(result.stdout) as { digest: string }).digest;
        expect(record.digest ?? record.registryDigest, `${file} digest`).toBe(digest);
        seen.push(file as string);
      }
    }
    // Both the pre-rebuild and the final registry are shown.
    expect(seen).toContain("registry-before-rebuild.json");
    expect(seen).toContain("registry.json");
  });

  test("F9 the README makes no false claim about the check output", () => {
    const readme = readReadme();
    expect(readme).not.toContain("empty `warnings`");
    expect(readme).not.toContain("no longer reaches");
  });

  test("F11 every route in both walkthrough registries is hosted", () => {
    for (const name of ["registry.json", "registry-before-rebuild.json"]) {
      const registry = readRegistryFile(name);
      for (const [model, definition] of Object.entries(registry.models)) {
        for (const route of definition.routes ?? []) {
          expect(route.hosted, `${name} ${model}`).toBe(true);
        }
      }
    }
  });

  test("F14 the decile oracle: five distinct values give exactly the even tenths", () => {
    expect(decileBands([1, 2, 3, 4, 5], "higher")).toEqual([
      { at: 5, score: 10 },
      { at: 4, score: 8 },
      { at: 3, score: 6 },
      { at: 2, score: 4 },
      { at: 1, score: 2 },
    ]);
  });

  test("F14 the decile oracle: two tenths sharing an at keep only the higher score", () => {
    expect(decileBands([3, 3, 4, 5, 6, 7, 8, 9, 10, 11], "higher")).toEqual([
      { at: 11, score: 10 },
      { at: 10, score: 9 },
      { at: 9, score: 8 },
      { at: 8, score: 7 },
      { at: 7, score: 6 },
      { at: 6, score: 5 },
      { at: 5, score: 4 },
      { at: 4, score: 3 },
      { at: 3, score: 2 },
    ]);
  });

  test("F14 the decile oracle: a lower direction case", () => {
    expect(decileBands([0.3, 0.5, 0.7, 0.9, 1.1], "lower")).toEqual([
      { at: 0.3, score: 10 },
      { at: 0.5, score: 8 },
      { at: 0.7, score: 6 },
      { at: 0.9, score: 4 },
      { at: 1.1, score: 2 },
    ]);
  });
});
