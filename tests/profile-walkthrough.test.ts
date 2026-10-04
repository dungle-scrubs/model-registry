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

interface WalkthroughRegistry {
  calibration: Calibration;
  models: Record<string, { ratings?: Record<string, number>; maxEffort?: string }>;
}

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

function readRegistry(): WalkthroughRegistry {
  return JSON.parse(readFileSync(join(root, "registry.json"), "utf8")) as WalkthroughRegistry;
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
    const readme = readFileSync(join(root, "README.md"), "utf8");
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
      readFileSync(join(root, "README.md"), "utf8"),
      readFileSync(join(root, "registry.json"), "utf8"),
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
});
