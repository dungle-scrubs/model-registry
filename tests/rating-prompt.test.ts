import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { repoRoot } from "./helpers.js";

const prompt = readFileSync(join(repoRoot, "prompts", "rating.md"), "utf8");

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

/**
 * The text of one `###` subsection, from its heading to the next `###` or
 * `##` heading.
 */
function subsection(title: string): string {
  const start = prompt.indexOf(`### ${title}`);
  if (start < 0) {
    return "";
  }
  const rest = prompt.slice(start);
  const nextSub = rest.indexOf("\n### ", 1);
  const nextSec = rest.indexOf("\n## ", 1);
  const next = [nextSub, nextSec].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  return next === undefined ? rest : rest.slice(0, next);
}

/** Text with runs of whitespace collapsed to single spaces, so assertions
 * survive the prompt's line wrapping. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

const step2 = section("Step 2 - propose bands, show the ratings they give, wait for approval");
const step3 = section("Step 3 - read and record figures");

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
    expect(prompt).toContain("ships no band numbers");
  });

  test("F3 the decile paragraph records the read identity in `version` and the method in `notes`", () => {
    const flattened = flat(step2);
    expect(flattened).not.toBe("");
    const decile = flattened.slice(flattened.indexOf("Write the bands best first"));
    expect(decile).not.toBe("");
    expect(decile).toContain("Record the read identity");
    expect(decile).toContain("`version`");
    expect(decile).toContain("`notes`");
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
    const aboveCap = flat(subsection("Figures above a model's effort cap"));
    expect(aboveCap).not.toBe("");
    expect(aboveCap).toContain("above-cap");
    expect(aboveCap).toContain("maxEffort");
    expect(aboveCap).toContain("no feed lists");
    expect(aboveCap).toContain("stays absent");
    expect(aboveCap).toContain("apart from");
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

  test("F3 bands are re-proposed on a new pinned read, never on a published version", () => {
    const reflate = flat(step2);
    expect(reflate).not.toBe("");
    expect(reflate).not.toContain("published version");
    expect(reflate).toContain("a new pinned read is taken whose");
    expect(reflate).toContain("identity differs from the `version` the table records");
  });

  test("F12 benchmark reads run as local commands with no key in the conversation", () => {
    const step3Flat = flat(step3);
    expect(step3Flat).not.toBe("");
    expect(step3Flat).toContain("local command");
    expect(step3Flat).toContain("the key stays in the local environment");
    expect(step3Flat).toContain("you never ask for or receive a key");
    const step1 = flat(section("Step 1 - ask which ratings, benchmarks and models matter"));
    expect(step1).toContain("local command");
  });

  test("F12 pinned reads are kept as one JSON file per read in reads/", () => {
    const pinned = flat(step2);
    expect(pinned).not.toBe("");
    expect(pinned).toContain("`reads/`");
    expect(pinned).toContain("one JSON file per read");
    expect(pinned).toContain("named like a model list snapshot");
    expect(pinned).toContain("every row read");
  });

  test("F12 Arena notes keep enough row evidence to distinguish duplicate names", () => {
    const arena = flat(subsection("Taste evidence from Arena WebDev `overall`"));
    expect(arena).not.toBe("");
    expect(arena).toContain("duplicate names");
  });

  test("F15 prose lines outside tables and code blocks stay within 80 columns", () => {
    const lines = prompt.split("\n");
    let inCode = false;
    const long: string[] = [];
    for (const line of lines) {
      if (line.startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode || line.startsWith("|")) {
        continue;
      }
      if (line.length > 80) {
        long.push(line);
      }
    }
    expect(long).toEqual([]);
  });
});
