import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { repoRoot } from "./helpers.js";

const promptPath = join(repoRoot, "prompts", "profile-builder.md");
const prompt = readFileSync(promptPath, "utf8");

/** The text of one `##` section, from its heading to the next `##` heading. */
function section(title: string): string {
  const start = prompt.indexOf(`## ${title}`);
  if (start < 0) {
    return "";
  }
  const rest = prompt.slice(start);
  const next = rest.indexOf("\n## ", 1);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("the profile builder prompt", () => {
  test("DW1 the interview runs the RFC's six steps in order, one question at a time", () => {
    const steps = [...prompt.matchAll(/^## Step (\d) - (.+)$/gm)];
    expect(steps.map(([, number]) => Number(number))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(steps.map(([, , title]) => title)).toEqual([
      "Platforms and plans",
      "Purpose and budget",
      "Aggregator narrowing",
      "Ratings and benchmark approval",
      "Desired score range",
      "Discovery, rating, then gap decisions",
    ]);
    expect(prompt).toContain("one question at a time");
  });

  test("DW1 steps whose facts the opening request already gave are skipped, and the prompt says so", () => {
    expect(prompt).toContain("opening request");
    expect(prompt).toContain("skip");
  });

  test("DW1 aggregator narrowing runs only when an aggregator is among the platforms", () => {
    const step3 = section("Step 3 - Aggregator narrowing");
    expect(step3).not.toBe("");
    expect(step3).toContain("only when an aggregator is among the platforms");
  });

  test("DW2 model lists are read as local commands and saved as lists/ snapshots with the contract fields", () => {
    expect(prompt).toContain("local command");
    expect(prompt).toContain("`lists/`");
    expect(prompt).toContain("beside `registry.json`");
    for (const field of ["`source`", "`method`", "`read`", "`scope`", "`modelIds`", "`revision`"]) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain("YYYY-MM-DD");
    expect(prompt).toContain("required for a pinned catalog read");
    // The non-secret source scope, with its examples.
    expect(prompt).toContain("`public`");
    expect(prompt).toContain("`api-key`");
    expect(prompt).toContain("`plan-a`");
    // Safe filenames.
    expect(prompt).toContain("lowercase letters, digits and hyphens");
  });

  test("DW2 a rebuild shows a diff the user approves, with evidence-backed renames and flagged departures", () => {
    expect(prompt).toContain("approve the diff");
    expect(prompt).toContain("flagged for removal");
    expect(prompt).toContain("rename");
  });

  test("DW3 the pinned catalog suggests at a recorded revision; a route needs an endpoint or harness read", () => {
    expect(prompt).toContain("models.dev");
    expect(prompt).toContain("revision");
    expect(prompt).toContain("suggests platforms and models");
    expect(prompt).toContain("endpoint or harness read");
  });

  test("DW4 an aggregator is narrowed before its read, with the ceiling facts recorded", () => {
    const step3 = section("Step 3 - Aggregator narrowing");
    expect(step3).toContain("before reading anything from the aggregator");
    expect(step3).toContain("currency");
    expect(step3).toContain("unit");
    expect(step3).toContain("price basis");
    expect(prompt).toContain("passing set");
  });

  test("DW5 bands from the user's own pinned reads are shown for approval in the proposal", () => {
    expect(prompt).toContain("prompts/rating.md");
    expect(prompt).toContain("from the user's own pinned reads");
    expect(prompt).toContain("approval");
    // The builder hands rating over; it restates no band method and no band numbers.
    expect(prompt).not.toContain("Lowest tenth");
  });

  test("DW6 record-only evidence is shown apart from the figures that feed ratings", () => {
    expect(prompt).toContain("figures above a model's effort cap");
    expect(prompt).toContain("apart from the figures that feed ratings");
  });

  test("DW7 rating is handed to the rating prompt and the last sh block runs both checks in order", () => {
    expect(prompt).toContain("prompts/rating.md");
    const blocks = prompt.match(/```sh\n([\s\S]*?)```/g) ?? [];
    const lastBlock = blocks.at(-1);
    expect(lastBlock?.trim()).toBe("```sh\nmodel-registry check\nmodel-router check\n```");
  });

  test("DW7 the prompt ships through the package exports", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      files: string[];
      exports: Record<string, string>;
    };
    expect(packageJson.exports["./prompts/profile-builder.md"]).toBe(
      "./prompts/profile-builder.md",
    );
    expect(packageJson.files).toContain("prompts");
  });
});
