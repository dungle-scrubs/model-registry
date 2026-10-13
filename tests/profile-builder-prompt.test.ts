import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { repoRoot } from "./helpers.js";
import { flat, longProseLines, readSkillText, skillFiles } from "./skill-text.js";

// The builder's text lives in several skill files: SKILL.md holds the shared
// rules, references/build-profile.md the build steps, references/snapshots.md
// the model list snapshots and rebuilds, and references/gaps.md the gap and
// check-finding rules. Each assertion reads the file its text lives in.
const skill = readSkillText("SKILL.md");
const build = readSkillText("references/build-profile.md");
const snapshots = readSkillText("references/snapshots.md");
const gaps = readSkillText("references/gaps.md");
const prompt = build.text;
const section = (title: string): string => build.section(title);
const subsection = (title: string): string => build.subsection(title);

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
    expect(flat(skill.section("The interview"))).toContain("one question at a time");
    expect(flat(build.lead)).toContain("The interview, approval and finishing rules in `SKILL.md`");
  });

  test("DW1 steps whose facts the opening request already gave are skipped, and the prompt says so", () => {
    const interview = skill.section("The interview");
    expect(flat(interview)).toContain("opening request");
    expect(interview).toContain("skip");
  });

  test("L-b one question asks for one fact, even a fact with parts", () => {
    const interview = flat(skill.section("The interview"));
    expect(interview).toContain("a fact with parts");
    expect(interview).toContain("asked as one question");
  });

  test("DW1 aggregator narrowing runs only when an aggregator is among the platforms", () => {
    const step3 = section("Step 3 - Aggregator narrowing");
    expect(step3).not.toBe("");
    expect(flat(step3)).toContain("only when an aggregator is among the platforms");
  });

  test("DW2 model lists are read as local commands and saved as lists/ snapshots with the contract fields", () => {
    expect(flat(prompt)).toContain("local command");
    expect(prompt).toContain("`references/snapshots.md`");
    const contract = snapshots.text;
    expect(flat(contract)).toContain("local command");
    expect(contract).toContain("`lists/`");
    expect(flat(contract)).toContain("beside the target registry file");
    for (const field of ["`source`", "`method`", "`read`", "`scope`", "`modelIds`", "`revision`"]) {
      expect(contract).toContain(field);
    }
    expect(contract).toContain("YYYY-MM-DD");
    expect(flat(contract)).toContain("required for a pinned catalog read");
    // The non-secret source scope, with its examples.
    expect(contract).toContain("`public`");
    expect(contract).toContain("`api-key`");
    expect(contract).toContain("`plan-a`");
    // Safe filenames.
    expect(flat(contract)).toContain("lowercase letters, digits and hyphens");
  });

  test("DW2 a rebuild shows a diff the user approves, with evidence-backed renames and flagged departures", () => {
    const rebuilds = flat(snapshots.section("Rebuilds and diffs"));
    expect(rebuilds).toContain("approve the diff");
    expect(rebuilds).toContain("flagged for removal");
    expect(rebuilds).toContain("rename");
  });

  test("M-4 a rebuild re-reads model list sources only", () => {
    const rebuilds = flat(snapshots.section("Rebuilds and diffs"));
    expect(rebuilds).toContain("re-reads each model list source the build used");
    expect(rebuilds).toContain("Benchmark reads in `reads/` are not re-read on a rebuild");
  });

  test("L-B the snapshot and rebuild gates cover model list sources only", () => {
    const snapshotRules = flat(snapshots.section("Snapshots"));
    expect(snapshotRules).toContain("every model list read the build uses");
    expect(snapshotRules).toContain("each model list source the build used");
    const rebuilds = flat(snapshots.section("Rebuilds and diffs"));
    expect(rebuilds).toContain("every model list source is re-read");
    expect(rebuilds).not.toContain("every source is re-read");
  });

  test("L-e snapshots and reads sit beside the target registry file, whatever its name", () => {
    const rating = readFileSync(
      join(repoRoot, "skills", "model-registry", "references", "rating.md"),
      "utf8",
    );
    for (const file of skillFiles()) {
      expect(flat(readSkillText(file).text), file).not.toContain("beside `registry.json`");
    }
    expect(flat(snapshots.text)).toContain("in `lists/` beside the target registry file");
    expect(flat(rating)).toContain("in `reads/` beside the registry file");
  });

  test("DW3 the pinned catalog suggests at a recorded revision; a route needs an endpoint or harness read", () => {
    expect(prompt).toContain("models.dev");
    expect(prompt).toContain("revision");
    expect(flat(prompt)).toContain("suggests platforms and models");
    expect(flat(prompt)).toContain("endpoint or harness read");
  });

  test("DW4 an aggregator is narrowed before its read, with the ceiling facts recorded", () => {
    const step3 = section("Step 3 - Aggregator narrowing");
    expect(flat(step3)).toContain("before reading anything from the aggregator");
    expect(step3).toContain("currency");
    expect(step3).toContain("unit");
    expect(flat(step3)).toContain("price basis");
    expect(flat(prompt)).toContain("passing set");
  });

  test("DW5 bands from the user's own pinned reads are shown for approval in the proposal", () => {
    expect(prompt).toContain("references/rating.md");
    expect(flat(prompt)).toContain("from the user's own pinned reads");
    expect(prompt).toContain("approval");
    // The builder hands rating over; no other skill file restates the band method.
    for (const file of skillFiles().filter((name) => name !== "references/rating.md")) {
      expect(flat(readSkillText(file).text), file).not.toContain("Lowest tenth");
    }
  });

  test("DW6 record-only evidence is shown apart from the figures that feed ratings", () => {
    expect(flat(prompt)).toContain("figures above a model's effort cap");
    expect(flat(prompt)).toContain("apart from the figures that feed ratings");
  });

  test("DW7 rating is handed to the rating prompt and the last sh block runs both checks in order", () => {
    expect(prompt).toContain("references/rating.md");
    expect(flat(section("Finishing"))).toContain("run the finishing checks in `SKILL.md`");
    const blocks = skill.text.match(/```sh\n([\s\S]*?)```/g) ?? [];
    const lastBlock = blocks.at(-1);
    expect(lastBlock?.trim()).toBe("```sh\nmodel-registry check\nmodel-router check\n```");
  });

  test("DW7 the prompt ships through the package exports", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      files: string[];
      exports: Record<string, string>;
    };
    for (const file of skillFiles()) {
      const path = `./skills/model-registry/${file}`;
      expect(packageJson.exports[path], path).toBe(path);
    }
    expect(packageJson.files).toContain("skills");
    expect(packageJson.files).not.toContain("prompts");
  });

  test("M-1 the reference's profile builder paragraph keeps the no-write rule to the registry", () => {
    const readme = readFileSync(join(repoRoot, "docs", "reference.md"), "utf8");
    const start = readme.indexOf("## Profile builder");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = readme.indexOf("\n## ", start + 1);
    const builder = flat(readme.slice(start, end));
    expect(builder).toContain("beside the target registry file");
    expect(builder).toContain("approved before the registry is written");
    expect(builder).not.toContain("beside `registry.json`");
    expect(builder).not.toContain("approved before anything is written");
  });

  test("F1 the opening hands rating over without following the rating prompt as written", () => {
    const opening = flat(skill.lead);
    expect(opening).toContain("hand every rating decision to the rating prompt");
    expect(opening).not.toContain("as written");
  });

  test("F1 the rating handoff runs Steps 1 to 3 and computes Step 4 without writing", () => {
    const handoff = flat(subsection("Rating handoff"));
    expect(handoff).not.toBe("");
    expect(handoff).toContain("run the rating prompt's Steps 1 to 3");
    expect(handoff).toContain("compute its Step 4 values");
    expect(handoff).toContain("goes into the proposal, not the file");
    expect(handoff).toContain("nothing is written to the registry file during the handoff");
    expect(handoff).toContain("already answered by interview Step 4");
    expect(handoff).toContain("carry those answers over");
    expect(handoff).toContain("ask only what is still open");
    expect(handoff).toContain("Its Step 4 write and its Step 5 check happen in Finishing");
    expect(handoff).toContain("are computed, unwritten, for every rated model and route");
  });

  test("M-1 the no-write rule covers the registry file only, and pinned reads are saved when taken", () => {
    expect(flat(skill.lead)).toContain(
      "write nothing to the registry file until the user approves",
    );

    const step4 = flat(section("Step 4 - Ratings and benchmark approval"));
    expect(step4).toContain("approves taking its pinned read");

    const handoff = flat(subsection("Rating handoff"));
    expect(handoff).toContain("nothing is written to the registry file during the handoff");
    expect(handoff).toContain("saved in `reads/` when taken");
    expect(handoff).not.toContain("nothing is written during the handoff");
  });

  test("M-B approving a source reuses an existing matching read, and changed bands reach other profiles", () => {
    const step4 = flat(section("Step 4 - Ratings and benchmark approval"));
    expect(step4).toContain("whose benchmark has no matching pinned read in `reads/`");
    expect(step4).toContain(
      "an existing matching read is reused unless the user asks for a new one",
    );
    expect(step4).toContain("before the registry is written");
    expect(step4).not.toContain("before anything is written");

    const proposal = flat(section("The proposal"));
    expect(proposal).toContain(
      "name every declared profile whose members' ratings move through changed bands or figures",
    );
  });

  test("L-A the handoff approval wording names the registry, not any write", () => {
    const handoff = flat(subsection("Rating handoff"));
    expect(handoff).not.toContain("before any write");
    expect(handoff).toContain("for approval before the registry is written");
  });

  test("M-2 the write list and proposal include the rating prompt's Step 1 output", () => {
    const handoff = flat(subsection("Rating handoff"));
    expect(handoff).toContain("`calibration.feeds`");

    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("3. The `ratings` declarations and `calibration.feeds`");

    const finishing = flat(section("Finishing"));
    expect(finishing).toContain("the `ratings` declarations and `calibration.feeds`");
    expect(finishing).toContain("everything the rating prompt's Steps 2 to 4 produced");
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
    const finishing = flat(gaps.section("Check findings"));
    expect(finishing).toContain("When it is another declared profile");
    expect(finishing).toContain("or offer to withdraw the shared change");
    expect(finishing).toContain("never changed without the user's explicit approval");
  });

  test("L-1 only a finding whose repair changes the registry becomes a revised proposal", () => {
    const finishing = flat(section("Finishing"));
    expect(finishing).toContain("whose repair changes the registry becomes a revised proposal");
  });

  test("L-2 and L-9 warnings on another declared profile are named, with the offer grammatical", () => {
    const finishing = flat(gaps.section("Check findings"));
    expect(finishing).toContain("or offer to withdraw the shared change");
    expect(finishing).toContain(
      "For a `profile-gap-stale` warning on another declared profile, name that profile",
    );
    expect(finishing).not.toContain("or withdrawing the shared change");
  });

  test("L-F the stale-gap warning on another declared profile sits with the warnings", () => {
    const paragraphs = gaps
      .section("Check findings")
      .split(/\n\n+/)
      .map((paragraph) => flat(paragraph));
    const warnings = paragraphs.find((paragraph) =>
      paragraph.includes("Show the user every warning"),
    );
    expect(warnings, "the warning paragraph").toBeDefined();
    expect(warnings).toContain("warning on another declared profile");
    const failure = paragraphs.find((paragraph) =>
      paragraph.includes("A failed declared-profile coverage check"),
    );
    expect(failure, "the coverage-failure paragraph").toBeDefined();
    expect(failure).not.toContain("warning on another declared profile");
  });

  test("L-j every Step 6 subsection ends with a Done-when gate", () => {
    const step6 = section("Step 6 - Discovery, rating, then gap decisions");
    expect(step6).not.toBe("");
    const titles = [...step6.matchAll(/^### (.+)$/gm)].map(([, title]) => title as string);
    expect(titles.length).toBeGreaterThanOrEqual(2);
    for (const title of titles) {
      expect(flat(subsection(title)), `### ${title}`).toContain("Done when");
    }
    for (const title of ["Snapshots", "Rebuilds and diffs"]) {
      expect(flat(snapshots.section(title)), `## ${title}`).toContain("Done when");
    }
  });

  test("F2 check warnings get a user decision before any path finishes", () => {
    // Finding 2: the warning rules apply to every path that writes, a ratings
    // refresh included, so they say "the work" rather than "the build".
    const finishing = flat(gaps.section("Check findings"));
    expect(finishing).toContain("profile-gap-unrecorded");
    expect(finishing).toContain("profile-gap-stale");
    expect(finishing).toContain("leave `default` implicit");
    expect(finishing).toContain("the work finishes when every warning has the user's decision");
    expect(finishing).toContain("approved before another write");
    const checks = flat(skill.section("Finishing checks"));
    expect(checks).toContain("Every path that writes the registry ends by running both checks");
    expect(checks).toContain(
      'Settle coverage findings and warnings under "Check findings" in `references/gaps.md`',
    );
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

  test("F7 the target registry file is settled before any path's first step and confirmed in Finishing", () => {
    // The target rule moved to SKILL.md, ahead of the path dispatch, so it
    // holds for every path, not only the build's Step 1.
    const target = flat(skill.section("The target file"));
    expect(target).not.toBe("");
    expect(skill.text.indexOf("## The target file")).toBeLessThan(
      skill.text.indexOf("## Choose the path"),
    );
    expect(target).toContain("Before the first step of any path");
    expect(target).toContain("the path the opening request names");
    expect(target).toContain("resolved default");
    expect(target).toContain("`path`");
    expect(target).toContain("`lists/` and `reads/`");

    const finishing = flat(skill.section("Finishing checks"));
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
    const rebuilds = flat(snapshots.section("Rebuilds and diffs"));
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

  test("82 2a the handoff recomputes the whole registry and the proposal names declared profiles", () => {
    const handoff = flat(subsection("Rating handoff"));
    expect(handoff).toContain("every model and route in the registry, not only the pool");
    expect(handoff).toContain("replace every figure under that benchmark");
    expect(handoff).toContain("recompute every rating it feeds");
    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("show every recomputed rating before the write");
    expect(proposal).toContain(
      "name every declared profile whose members' ratings move through changed bands or figures",
    );
  });

  test("82 2b the handoff saves immutable named reads and rejection preserves them", () => {
    const handoff = flat(subsection("Rating handoff"));
    expect(handoff).toContain("never overwritten");
    expect(handoff).toContain("<source-name>-<version>-<read-date>.json");
    expect(handoff).toContain("rating prompt's Pinned read files rule");
    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("rejected proposal or rejected bands leave the registry unchanged");
    expect(proposal).toContain("new read file stays in `reads/`");
    const finishing = flat(section("Finishing"));
    expect(finishing).toContain("only after the user approves");
    expect(finishing).toContain("Remove an old read only after the user approves its removal");
    expect(finishing).toContain("After the registry write you may offer removal");
    expect(finishing).not.toContain("offer removal of an old read only after");
    expect(finishing).toContain("no benchmark in the registry matches it by source and version");
    expect(finishing).toContain("never before the registry write");
    expect(finishing).toContain("never remove it unasked");
  });

  test("82 2c the proposal asks about each record-only key instead of moving it automatically", () => {
    const handoff = flat(subsection("Rating handoff"));
    expect(handoff).toContain("record-only key sharing the source keeps its own pinned read");
    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("List every record-only key sharing that source");
    expect(proposal).toContain("ask whether to move it too");
    expect(proposal).toContain(
      "On yes, move its `version` and figures by the rating prompt's rule",
    );
    expect(proposal).toContain("on no, keep its old `version`, figures and read file");
  });

  test("82 L-2 source approval uses the rating match rule and answers its no-match offer", () => {
    const step4 = flat(section("Step 4 - Ratings and benchmark approval"));
    expect(step4).toContain("rating prompt's Step 3 source-and-version match rule");
    expect(step4).toContain("Step 4 approval with no matching read is the yes to that offer");
    expect(step4).toContain("say so in one line");
  });

  test("82 L-3 the reference distinguishes model list snapshots and immutable benchmark reads", () => {
    const readme = flat(readFileSync(join(repoRoot, "docs", "reference.md"), "utf8"));
    expect(readme).toContain("each model list read saved as a JSON snapshot in `lists/`");
    expect(readme).toContain("Pinned benchmark read files in `reads/` are never overwritten");
  });

  test("R5 each new model's effort limits are settled during discovery, before the rating handoff", () => {
    const limits = flat(subsection("Model effort limits"));
    expect(limits).not.toBe("");
    expect(prompt.indexOf("### Model effort limits")).toBeLessThan(
      prompt.indexOf("### Rating handoff"),
    );
    expect(prompt.indexOf("### Discovery reads")).toBeLessThan(
      prompt.indexOf("### Model effort limits"),
    );
    expect(limits).toContain("Before the rating handoff");
    expect(limits).toContain("`maxEffort` and `fixedEffort`");
    expect(limits).toContain("None is guessed");
    expect(limits).toContain("ask the user");
    expect(limits).toContain("an absent `maxEffort` means no ceiling");
    expect(flat(subsection("Rating handoff"))).toContain("the effort limits settled above");
    const proposal = flat(section("The proposal"));
    expect(proposal).toContain("settled under Model effort limits");
    expect(proposal).toContain("item 2 shows each with its source");
  });

  test("R3 gap answers offer a rating record only when a compatible member can hold it", () => {
    const coverage = flat(gaps.section("How coverage is checked"));
    expect(coverage).toContain("Requirements must clear together on one route");
    const shapes = flat(gaps.section("Gap records"));
    expect(shapes).toContain('{ "rating": "coding", "accepts": 6, "reason":');
    expect(shapes).toContain('{ "capability": "browser", "reason":');
    expect(shapes).toContain("an integer from 1 to 10");
    expect(shapes).toContain("at most one record per rating and one per capability");
    const offers = flat(gaps.section("Offering gap answers"));
    expect(offers).toContain(
      "Accept a rating gap with a reason, only when a compatible member exists",
    );
    expect(offers).toContain("clears every other requirement of the same task and stakes level");
    expect(offers).toContain("no rating record can make coverage pass. Do not offer one");
    expect(offers).toContain("obtain the rating through `references/rating.md`");
    expect(offers).toContain("an override or a hand-set value the user approves");
    expect(offers).toContain("or a filling route");
    expect(offers).toContain("A profile borrows no route from another profile");
    const decisions = flat(subsection("Gap decisions"));
    expect(decisions).toContain("`references/gaps.md`");
    expect(decisions).toContain("when a valid record can express it");
  });

  test("R4 a narrow addition runs only the parts it needs", () => {
    const adding = flat(section("Adding a platform or model"));
    expect(adding).not.toBe("");
    expect(adding).toContain("for the new platform or model only");
    expect(adding).toContain("Skip Steps 2, 4 and 5 unless a fact they ask for is missing");
    expect(adding).toContain("Profile membership changes only when the user names a profile");
    const recording = flat(gaps.section("Recording a gap"));
    expect(recording).toContain("Ask only for what the request and the file do not give");
    expect(recording).toContain("When no valid record can express it, say so");
  });

  test("F15 prose lines outside tables and code blocks stay within 80 columns", () => {
    for (const file of skillFiles()) {
      expect(longProseLines(readSkillText(file).text), file).toEqual([]);
    }
  });
});
