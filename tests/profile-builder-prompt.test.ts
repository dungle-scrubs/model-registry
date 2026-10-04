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

/** The opening, before the first `##` heading. */
const lead = prompt.split("\n## ")[0] ?? "";

/** Text with runs of whitespace collapsed to single spaces, so assertions
 * survive the prompt's line wrapping. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
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
    const interview = section("The interview");
    expect(interview).toContain("opening request");
    expect(interview).toContain("skip");
  });

  test("DW1 aggregator narrowing runs only when an aggregator is among the platforms", () => {
    const step3 = section("Step 3 - Aggregator narrowing");
    expect(step3).not.toBe("");
    expect(step3).toContain("only when an aggregator is among the platforms");
  });

  test("DW2 model lists are read as local commands and saved as lists/ snapshots with the contract fields", () => {
    expect(prompt).toContain("local command");
    expect(prompt).toContain("`lists/`");
    expect(flat(prompt)).toContain("beside the target registry file");
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
    const rebuilds = flat(subsection("Rebuilds and diffs"));
    expect(rebuilds).toContain("approve the diff");
    expect(rebuilds).toContain("flagged for removal");
    expect(rebuilds).toContain("rename");
  });

  test("L-e snapshots and reads sit beside the target registry file, whatever its name", () => {
    const rating = readFileSync(join(repoRoot, "prompts", "rating.md"), "utf8");
    for (const text of [prompt, rating]) {
      expect(flat(text)).not.toContain("beside `registry.json`");
    }
    expect(flat(prompt)).toContain("in `lists/` beside the target registry file");
    expect(flat(rating)).toContain("in `reads/` beside the registry file");
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

  test("F1 the opening hands rating over without following the rating prompt as written", () => {
    const opening = flat(lead);
    expect(opening).toContain("hand every rating decision to the rating prompt");
    expect(opening).not.toContain("as written");
  });

  test("F1 the rating handoff runs Steps 1 to 3 and computes Step 4 without writing", () => {
    const handoff = flat(subsection("Rating handoff"));
    expect(handoff).not.toBe("");
    expect(handoff).toContain("run the rating prompt's Steps 1 to 3");
    expect(handoff).toContain("compute its Step 4 values");
    expect(handoff).toContain("goes into the proposal, not the file");
    expect(handoff).toContain("nothing is written during the handoff");
    expect(handoff).toContain("already answered by interview Step 4");
    expect(handoff).toContain("carry those answers over");
    expect(handoff).toContain("ask only what is still open");
    expect(handoff).toContain("Its Step 4 write and its Step 5 check happen in Finishing");
    expect(handoff).toContain("are computed, unwritten, for every rated model and route");
  });

  test("N1 Finishing writes everything the rating prompt produced, in one approved write", () => {
    const finishing = flat(section("Finishing"));
    expect(finishing).toContain("write the registry in one write");
    expect(finishing).toContain("everything the rating prompt's Steps 2 to 4 produced");
    expect(finishing).toContain("`calibration`");
    expect(finishing).toContain("figures");
    expect(finishing).toContain("overrides");
    expect(finishing).toContain("`handSet`");
  });

  test("N2 the builder's revise rule replaces the rating prompt's Step 5 fix loop", () => {
    const finishing = flat(section("Finishing"));
    expect(finishing).toContain("replaces the rating prompt's Step 5 fix loop");
    expect(finishing).toContain("`rating-mismatch`");
  });

  test("N4 new model facts come from cited evidence or the user", () => {
    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("`maxEffort`");
    expect(proposal).toContain("`capabilities`");
    expect(proposal).toContain("None is guessed");
  });

  test("N5 the proposal names the other declared profiles the shared changes reach", () => {
    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("every other declared profile");
  });

  test("N5 a coverage failure on another declared profile is the user's choice", () => {
    const finishing = flat(section("Finishing"));
    expect(finishing).toContain("When it is another declared profile");
    expect(finishing).toContain("withdrawing the shared change");
    expect(finishing).toContain("never changed without the user's explicit approval");
  });

  test("L-j every Step 6 subsection ends with a Done-when gate", () => {
    const step6 = section("Step 6 - Discovery, rating, then gap decisions");
    expect(step6).not.toBe("");
    const titles = [...step6.matchAll(/^### (.+)$/gm)].map(([, title]) => title as string);
    expect(titles.length).toBeGreaterThanOrEqual(2);
    for (const title of titles) {
      expect(flat(subsection(title)), `### ${title}`).toContain("Done when");
    }
  });

  test("F2 check warnings get a user decision before the build finishes", () => {
    const finishing = flat(section("Finishing"));
    expect(finishing).toContain("profile-gap-unrecorded");
    expect(finishing).toContain("profile-gap-stale");
    expect(finishing).toContain("leave `default` implicit");
    expect(finishing).toContain("the build finishes when every warning has the user's decision");
    expect(finishing).toContain("approved before another write");
  });

  test("F4 aggregator narrowing is required before an aggregator read", () => {
    const step3 = flat(section("Step 3 - Aggregator narrowing"));
    expect(step3).toContain("must give a price ceiling, a provider subset, or both");
    expect(step3).not.toContain("needs none");
    expect(step3).toContain("the aggregator is not read and adds no candidates");
    expect(step3).toContain("or the aggregator is left out");
  });

  test("F5 a catalog-suggested platform is asked about before it joins", () => {
    const discovery = flat(subsection("Discovery reads"));
    expect(discovery).not.toBe("");
    expect(discovery).toContain(
      "When the catalog suggests a platform the user did not list, ask about it as one question",
    );
    expect(discovery).toContain("Only on the user's yes");
    expect(discovery).toContain("at the position the user gives");
    expect(discovery).toContain("Without a yes it is not read and supplies no route");
  });

  test("F6 platform order sets each model's routes array, and labels carry no ranking", () => {
    const step1 = flat(section("Step 1 - Platforms and plans"));
    expect(step1).toContain("each model's `routes` array");
    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("each model's `routes`");
    expect(proposal).toContain("the label list carries no ranking");
    expect(proposal).toContain("breaks ties on equal cost");
    expect(proposal).toContain("approves a global reorder");
  });

  test("F7 the target registry file is settled before Step 1 and confirmed in Finishing", () => {
    const target = flat(section("The target file"));
    expect(target).not.toBe("");
    expect(prompt.indexOf("## The target file")).toBeLessThan(prompt.indexOf("## Step 1"));
    expect(target).toContain("the path the opening request names");
    expect(target).toContain("resolved default");
    expect(target).toContain("`path`");
    expect(target).toContain("`lists/` and `reads/`");

    const finishing = flat(section("Finishing"));
    expect(finishing).toContain("--registry <path>");
    expect(finishing).toContain("`path` from `model-registry check`");
    expect(finishing).toContain("`registryPath` from `model-router check`");
    expect(finishing).toContain("equals the written file");
  });

  test("F8 shared task floors are asked from the user, as suggestions at most", () => {
    const floors = flat(subsection("Shared task floors"));
    expect(floors).not.toBe("");
    expect(floors).toContain("floors per stakes level");
    expect(floors).toContain("one task per question");
    expect(floors).toContain("marked as suggestions");

    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("`tasks`");
    expect(proposal).toContain("apply to every profile, including the implicit `default`");
  });

  test("F10 a failed read or rejected diff offers retry, old snapshot or stop; a rejected flag keeps the route", () => {
    const rebuilds = flat(subsection("Rebuilds and diffs"));
    expect(rebuilds).toContain("pauses");
    expect(rebuilds).toContain("old snapshot stays");
    expect(rebuilds).toContain("retry the read");
    expect(rebuilds).toContain("continue on the old snapshot with the user's explicit approval");
    expect(rebuilds).toContain("or stop");
    expect(rebuilds).toContain("keeps the route");
    expect(rebuilds).toContain("kept on a platform whose latest read no longer lists it");
  });

  test("F11 each new route's hosted flag is written from evidence the user confirms", () => {
    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("`hosted`");
    expect(proposal).toContain("from evidence the user confirms");
    expect(proposal).toContain("a local runtime on the user's machine is not hosted");
    expect(proposal).toContain("a provider, subscription service or aggregator is");
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
