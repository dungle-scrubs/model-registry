/** The rating a benchmark feeds, or the one it only evidences. */
export type BenchmarkRating = "intelligence" | "coding" | "cost" | "taste-evidence";

/**
 * How a benchmark is recommended. `true` recommends it always;
 * `"only-without-key"` recommends it only while no Artificial Analysis key
 * is saved, because the key-based source then covers the same rating.
 */
export type BenchmarkRecommendation = boolean | "only-without-key";

export interface BenchmarkCatalogEntry {
  /** The id the intake file and the skill's rating method share. */
  readonly id: string;
  readonly label: string;
  /** The one-line hint shown beside the option. */
  readonly hint: string;
  readonly rating: BenchmarkRating;
  /** True when the benchmark needs the Artificial Analysis API key. */
  readonly needsKey: boolean;
  readonly recommended: BenchmarkRecommendation;
}

/** The harness names model-router and hcn use, with the names they show. */
export interface HarnessCatalogEntry {
  readonly id: string;
  readonly label: string;
}

export const HARNESS_CATALOG: readonly HarnessCatalogEntry[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex CLI" },
  { id: "cursor", label: "Cursor agent" },
  { id: "pi", label: "pi" },
  { id: "antigravity", label: "Antigravity" },
  { id: "muse", label: "Muse" },
];

/**
 * The value the "Other" option carries in a prompt. It cannot be a harness
 * name, so it never collides with a name the user types.
 */
export const OTHER_HARNESS_ID = "__other__";

export const BENCHMARK_CATALOG: readonly BenchmarkCatalogEntry[] = [
  {
    id: "aa-intelligence",
    label: "Artificial Analysis Intelligence Index",
    hint: "Reads the intelligence rating; needs your Artificial Analysis key.",
    rating: "intelligence",
    needsKey: true,
    recommended: true,
  },
  {
    id: "aa-cost",
    label: "Artificial Analysis cost per task",
    hint: "Reads the route cost rating; needs your Artificial Analysis key.",
    rating: "cost",
    needsKey: true,
    recommended: true,
  },
  {
    id: "epoch-eci",
    label: "Epoch AI Capabilities Index",
    hint: "Reads the intelligence rating from the Epoch AI benchmark data.",
    rating: "intelligence",
    needsKey: false,
    recommended: "only-without-key",
  },
  {
    id: "livebench-coding",
    label: "LiveBench Coding and Agentic Coding",
    hint: "Reads the coding rating from the LiveBench release tables.",
    rating: "coding",
    needsKey: false,
    recommended: true,
  },
  {
    id: "terminal-bench",
    label: "Terminal-Bench 4.0",
    hint: "Reads the coding rating from the Harbor Hub leaderboard.",
    rating: "coding",
    needsKey: false,
    recommended: false,
  },
  {
    id: "openrouter-pricing",
    label: "OpenRouter list prices",
    hint: "Reads the route cost rating from the OpenRouter model list.",
    rating: "cost",
    needsKey: false,
    recommended: "only-without-key",
  },
  {
    id: "livebench-cost",
    label: "LiveBench cost per task",
    hint: "Reads the route cost rating from the LiveBench cost table.",
    rating: "cost",
    needsKey: false,
    recommended: false,
  },
  {
    id: "arena-webdev",
    label: "Arena WebDev",
    hint: "Evidence for a taste rating you set by hand.",
    rating: "taste-evidence",
    needsKey: false,
    recommended: true,
  },
];

/** The benchmarks the wizard offers when a key is saved, and when it is not. */
export function offeredBenchmarks(hasKey: boolean): readonly BenchmarkCatalogEntry[] {
  return BENCHMARK_CATALOG.filter((entry) => !entry.needsKey || hasKey);
}

/** The benchmarks the wizard preselects for the key state the user chose. */
export function recommendedBenchmarks(hasKey: boolean): readonly string[] {
  return offeredBenchmarks(hasKey)
    .filter((entry) =>
      entry.recommended === true
        ? true
        : entry.recommended === "only-without-key"
          ? !hasKey
          : false,
    )
    .map((entry) => entry.id);
}
