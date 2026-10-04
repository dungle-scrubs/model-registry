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
  notes?: string;
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

/** The transcript's turns, in README order: every block that opens with an
 * Agent or User marker. */
function turns(readme: string): Array<{ role: "Agent" | "User"; text: string }> {
  return readme.split(/\n\n+/).flatMap((block) => {
    const match = block.match(/^\*\*(Agent|User):\*\* ([\s\S]*)$/);
    return match === null
      ? []
      : [{ role: match[1] as "Agent" | "User", text: flat(match[2] ?? "") }];
  });
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

  test("F7 the walkthrough checks confirm the reported path is the file the command names", () => {
    expect(flat(readReadme())).toContain(
      "each reported `path` and `registryPath` is the file the command names",
    );
  });

  test("L-a the walkthrough names its target file and passes --registry to both checks", () => {
    const readme = readReadme();
    const start = readme.indexOf("## The opening request");
    const end = readme.indexOf("## Step 3");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(readme.slice(start, end)).toContain("registry.json");
    expect(flat(readme)).toContain("both checks pass `--registry`");
  });

  test("N4 the walkthrough proposal shows its model facts with sources", () => {
    const flattened = flat(readReadme());
    const item2 = flattened.slice(
      flattened.indexOf("2. Shared fact changes:"),
      flattened.indexOf("3. The rating declarations"),
    );
    expect(item2).not.toBe("");
    expect(item2).toContain("harness-x documentation");
    expect(item2).toContain("`maxEffort` high");
    const hostedAt = item2.indexOf("Each route's `hosted`");
    const hosted = item2.slice(hostedAt, item2.indexOf("; ", hostedAt));
    expect(hosted).toContain("platform-b");
    expect(hosted).toContain("provider-2");
  });

  test("M-2 the walkthrough proposal names the Step 1 declarations and feeds", () => {
    const flattened = flat(readReadme());
    const item3 = flattened.slice(
      flattened.indexOf("3. The rating declarations"),
      flattened.indexOf("4. The accepted"),
    );
    expect(item3).not.toBe("");
    expect(item3).toContain("`calibration.feeds`");
    expect(item3).toContain("cost-9 override");
    expect(item3).toContain("figures");
    const item2 = flattened.slice(
      flattened.indexOf("2. Shared fact changes:"),
      flattened.indexOf("3. The rating declarations"),
    );
    expect(item2).not.toContain("ratings coding and taste");
    expect(flattened).toContain("Step 1 declarations and feeds");
  });

  test("L-b the walkthrough Step 4 asks only for the open facts", () => {
    const readme = readReadme();
    const start = readme.indexOf("## Step 4");
    const end = readme.indexOf("## Step 6");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const step4 = flat(readme.slice(start, end));
    expect(step4).not.toContain("Which ratings matter");
    expect(step4).toContain("You named coding and taste");
  });

  test("M-1 approving the sources approves taking their pinned reads", () => {
    const readme = readReadme();
    const start = readme.indexOf("## Step 4");
    const end = readme.indexOf("## Step 6");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const step4 = flat(readme.slice(start, end));
    expect(step4).toContain("approves taking their pinned reads");
  });

  test("M-4 the walkthrough rebuild re-reads every model list source the build used", () => {
    expect(flat(readReadme())).toContain("re-reads every model list source the build used");
  });

  test("L-h the untagged leaderboard row is not stored as a figure", () => {
    const flattened = flat(readReadme());
    expect(flattened).toContain("not stored as a figure");
    expect(flattened).not.toContain("not stored as evidence");
  });

  test("N3 every figure in both registries comes from the pinned read its benchmark names", () => {
    interface PinnedRead {
      source: string;
      version: string;
      read: string;
      rows: Array<{ id: string; value: number; effort?: string }>;
    }
    const reads = readdirSync(join(root, "reads")).map((name) => ({
      name,
      data: JSON.parse(readFileSync(join(root, "reads", name), "utf8")) as PinnedRead,
    }));
    expect(reads.length).toBeGreaterThan(0);
    for (const file of ["registry.json", "registry-before-rebuild.json"]) {
      const registry = readRegistryFile(file);
      let checked = 0;
      for (const [subject, benchmarks] of Object.entries(registry.calibration.figures)) {
        const model = registry.models[subject];
        for (const [benchmarkName, figure] of Object.entries(benchmarks)) {
          checked += 1;
          const benchmark = registry.calibration.benchmarks[benchmarkName];
          if (benchmark === undefined) {
            throw new Error(`${file} has a figure under an undeclared benchmark ${benchmarkName}`);
          }
          const read = reads.find(
            (entry) =>
              entry.data.source === benchmark.source && entry.data.version === benchmark.version,
          );
          if (read === undefined) {
            throw new Error(
              `${file} ${subject}/${benchmarkName}: no pinned read for ${benchmark.source} at ${benchmark.version}`,
            );
          }
          // The row id: the route label for a route figure, else the model's
          // modelId or a source row name the benchmark's notes map to it.
          const ids =
            model === undefined
              ? [subject]
              : [
                  ...(model.routes ?? []).map((route) => String(route.modelId)),
                  ...[...(benchmark.notes ?? "").matchAll(/row '([^']+)' maps to (\S+)/g)]
                    .filter(([, , target]) => target === subject)
                    .map(([, rowName]) => rowName as string),
                ];
          const row = read.data.rows.find(
            (candidate) =>
              ids.includes(candidate.id) &&
              candidate.value === figure.value &&
              (candidate.effort === undefined || candidate.effort === figure.effort),
          );
          if (row === undefined) {
            throw new Error(
              `${file} ${subject}/${benchmarkName}: no row ${ids.join(" or ")} in ${read.name} carries ${figure.value}`,
            );
          }
          expect(figure.read, `${file} ${subject}/${benchmarkName} read date`).toBe(read.data.read);
        }
      }
      expect(checked, `${file} figure count`).toBeGreaterThan(0);
    }
  });

  test("M-A every fed or above-cap benchmark has exactly one read matching its source and version", () => {
    const registry = readRegistry();
    const fed = new Set(Object.values(registry.calibration.feeds).flat());
    const reads = readdirSync(join(root, "reads")).map((name) => ({
      name,
      data: JSON.parse(readFileSync(join(root, "reads", name), "utf8")) as {
        source: string;
        version: string;
      },
    }));
    const covered: string[] = [];
    for (const [name, benchmark] of Object.entries(registry.calibration.benchmarks)) {
      if (!fed.has(name) && !name.endsWith("-above-cap")) {
        continue;
      }
      covered.push(name);
      const matches = reads.filter(
        (entry) =>
          entry.data.source === benchmark.source && entry.data.version === benchmark.version,
      );
      expect(matches, `${name} pinned reads matching source and version`).toHaveLength(1);
    }
    expect(covered.length).toBeGreaterThan(0);
    // The shared-version case the source-plus-version rule exists for.
    const versions = covered.map((name) => registry.calibration.benchmarks[name]?.version ?? "");
    expect(new Set(versions).size).toBeLessThan(versions.length);
  });

  test("the check commands name the file their output reports", () => {
    const readme = readReadme();
    const lines = readme.split("\n");
    let seen = 0;
    for (let index = 0; index + 1 < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const match = line.match(/^\$ (model-registry|model-router) check --registry (\S+)$/);
      if (match === null) {
        continue;
      }
      seen += 1;
      const record = JSON.parse(lines[index + 1] ?? "") as {
        path?: string;
        registryPath?: string;
      };
      const reported = record.path ?? record.registryPath;
      expect(reported, line).toBeDefined();
      expect(reported?.endsWith(`/${match[2]}`), line).toBe(true);
    }
    expect(seen).toBe(4);
  });

  test("the walkthrough pins its five decision turns, each answered, in README order", () => {
    const readme = readReadme();
    const list = turns(readme);
    // One agent turn matching every phrase, answered by the next turn.
    const ask = (...phrases: string[]) => {
      const hits = list
        .map((turn, index) => ({ turn, index }))
        .filter(({ turn }) => turn.role === "Agent" && phrases.every((p) => turn.text.includes(p)));
      expect(hits.length, `agent turn asking ${phrases.join(" + ")}`).toBe(1);
      const { index } = hits[0] as {
        turn: { role: "Agent" | "User"; text: string };
        index: number;
      };
      return index;
    };
    const answered = (agentIndex: number, phrase: string) => {
      const answer = list[agentIndex + 1];
      expect(answer?.role, `turn after ${agentIndex}`).toBe("User");
      expect(answer?.text, `turn after ${agentIndex}`).toContain(phrase);
    };
    // 1. The taste ask for model-c, and the user leaving its taste unset.
    const taste = ask("And model-c?", "set a taste");
    answered(taste, "leave its taste unset");
    // 2. The high-stakes gap offer: three ways out, with a recommendation.
    const gap = ask(
      "hand-set model-c's taste at 5 or above",
      "look for another model",
      "coding ceiling of 7",
      "My recommendation:",
    );
    answered(gap, "Accept coding 7");
    // 3. The first checks' warning turn: the three repair choices, answered
    // before the rebuild.
    const warning = ask(
      "add a filling route",
      "gap record",
      "leave `default` implicit",
      "My recommendation:",
    );
    answered(warning, "Leave `default` implicit.");
    // 4. The rebuild's revised proposal, approved before the route leaves.
    const revised = ask("Approve the revised proposal before I write?");
    answered(revised, "Approved. Write it.");
    // 5. The final implicit-default ask and its answer.
    const finalAsk = ask("Keep `default` implicit?");
    answered(finalAsk, "Yes, keep it implicit.");
    expect(taste).toBeLessThan(gap);
    expect(gap).toBeLessThan(warning);
    expect(warning).toBeLessThan(revised);
    expect(revised).toBeLessThan(finalAsk);
    const rebuildAt = readme.indexOf("## The rebuild");
    expect(readme.indexOf("You can add a filling route")).toBeLessThan(rebuildAt);
    expect(readme.indexOf("**User:** Leave `default` implicit.")).toBeLessThan(rebuildAt);
    const leavesAt = readme.indexOf("The route leaves the profile and the registry");
    const revisedAt = readme.indexOf("Approve the revised proposal before I write?");
    expect(revisedAt).toBeLessThan(leavesAt);
    const approvedAt = readme.indexOf("**User:** Approved. Write it.", revisedAt);
    expect(approvedAt).toBeGreaterThan(revisedAt);
    expect(approvedAt).toBeLessThan(leavesAt);
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
