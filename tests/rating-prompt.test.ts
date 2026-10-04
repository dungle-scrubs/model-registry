import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { repoRoot } from "./helpers.js";

const prompt = readFileSync(join(repoRoot, "prompts", "rating.md"), "utf8");

describe("the rating prompt's suggested benchmarks and bands", () => {
  test("DW5 the suggestions table names the offered sources and their conditions", () => {
    expect(prompt).toContain("Artificial Analysis Intelligence Index");
    expect(prompt).toContain("Artificial Analysis Coding Index");
    expect(prompt).toContain("cost per task");
    expect(prompt).toContain("Arena WebDev `overall`");
    expect(prompt).toContain("their own key");
    expect(prompt).toContain("provider and effort match");
    expect(prompt).toContain("never a feed");
  });

  test("DW5 suggested bands come from the decile table over the user's own pinned read", () => {
    expect(prompt).toContain("pinned read");
    const decileRows: ReadonlyArray<readonly [string, number]> = [
      ["Lowest tenth", 1],
      ["Second tenth", 2],
      ["Third tenth", 3],
      ["Fourth tenth", 4],
      ["Fifth tenth", 5],
      ["Sixth tenth", 6],
      ["Seventh tenth", 7],
      ["Eighth tenth", 8],
      ["Ninth tenth", 9],
      ["Top tenth", 10],
    ];
    for (const [label, score] of decileRows) {
      expect(prompt).toContain(`| ${label} | ${score} |`);
    }
    expect(prompt).toContain("worst to best");
    expect(prompt).toContain("direction");
    expect(prompt).toContain("gives no band");
    expect(prompt).toContain("keep the higher score only");
    expect(prompt).toContain("invent a band");
    // Read identity in `version`, method in `notes`.
    expect(prompt).toMatch(/`version`[\s\S]*`notes`/);
    expect(prompt).toContain("ships no band numbers");
  });

  test("DW5 no band numbers or Arena quartiles ship in either prompt", () => {
    const builder = readFileSync(join(repoRoot, "prompts", "profile-builder.md"), "utf8");
    for (const text of [prompt, builder]) {
      expect(text).not.toMatch(/"at":\s*[0-9]/);
      for (const quartile of ["1357", "1440", "1556"]) {
        expect(text).not.toContain(quartile);
      }
    }
  });

  test("DW6 Arena WebDev overall is evidence for a hand-set taste", () => {
    expect(prompt).toContain("Hugging Face");
    expect(prompt).toContain("lmarena-ai/leaderboard-dataset");
    expect(prompt).toContain("pinned revision");
    expect(prompt).toContain("`overall`");
    expect(prompt).toContain("`webdev`");
    expect(prompt).toContain("`handSet`");
    expect(prompt).toContain("CC BY 4.0");
    expect(prompt).toContain("effort unspecified");
    expect(prompt).toContain("never stored");
  });

  test("DW6 above-cap figures are recorded under a distinct key and never fed", () => {
    expect(prompt).toContain("above-cap");
    expect(prompt).toContain("maxEffort");
    expect(prompt).toContain("no feed lists");
    expect(prompt).toContain("stays absent");
    expect(prompt).toContain("apart from");
  });

  test("the five-step contract holds after the wording patch", () => {
    for (const step of ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]) {
      expect(prompt).toContain(step);
    }
    expect(prompt).toContain("no default bands");
    const blocks = prompt.match(/```sh\n([\s\S]*?)```/g) ?? [];
    const lastBlock = blocks.at(-1);
    expect(lastBlock?.trim()).toBe("```sh\nmodel-registry check\n```");
  });
});
