import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadRegistry } from "../src/load-registry.js";
import { withTempDir, writeJson } from "./helpers.js";
import { flat, longProseLines, readSkillText, skillDir, skillFiles } from "./skill-text.js";

const skillPath = join(skillDir, "SKILL.md");
const skill = readFileSync(skillPath, "utf8");
const body = readSkillText("SKILL.md");

/** Parse one frontmatter line `key: value` into a `[key, value]` tuple, or
 * `null` when the line does not match the simple scalar form. */
function parseFrontmatterLine(line: string): readonly [string, string] | null {
  const match = /^([a-zA-Z][a-zA-Z0-9_-]*): (.*)$/.exec(line);
  if (match === null) {
    return null;
  }
  return [match[1] ?? "", match[2] ?? ""];
}

describe("the model-registry skill", () => {
  test("SKILL.md starts with a YAML frontmatter fence", () => {
    expect(skill.startsWith("---\n")).toBe(true);
  });

  test("frontmatter has exactly the keys `name` and `description`", () => {
    const lines: string[] = [];
    const body = skill.slice(4);
    const closing = body.indexOf("\n---");
    expect(closing).toBeGreaterThanOrEqual(0);
    const frontmatter = body.slice(0, closing);
    for (const line of frontmatter.split("\n")) {
      const parsed = parseFrontmatterLine(line);
      if (parsed !== null) {
        lines.push(parsed[0]);
      }
    }
    expect(lines.sort()).toEqual(["description", "name"]);
  });

  test("`name` is `model-registry`, the parent directory name, and a valid slug", () => {
    const body = skill.slice(4);
    const closing = body.indexOf("\n---");
    expect(closing).toBeGreaterThanOrEqual(0);
    const frontmatter = body.slice(0, closing);
    const parsed = frontmatter
      .split("\n")
      .map((line) => parseFrontmatterLine(line))
      .find((entry) => entry?.[0] === "name");
    expect(parsed).not.toBeUndefined();
    const name = parsed?.[1] ?? "";
    expect(name).toBe("model-registry");
    expect(name).toBe(basename(dirname(skillPath)));
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("`description` is non-empty and at most 1024 characters", () => {
    const body = skill.slice(4);
    const closing = body.indexOf("\n---");
    expect(closing).toBeGreaterThanOrEqual(0);
    const frontmatter = body.slice(0, closing);
    const parsed = frontmatter
      .split("\n")
      .map((line) => parseFrontmatterLine(line))
      .find((entry) => entry?.[0] === "description");
    expect(parsed).not.toBeUndefined();
    const description = parsed?.[1] ?? "";
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  test("SKILL.md has at most 500 lines", () => {
    expect(skill.split("\n").length).toBeLessThanOrEqual(500);
  });

  test("no skill file mentions `prompts/` or `/Users/`", () => {
    const files = skillFiles();
    expect(files).toContain("SKILL.md");
    expect(files).toContain("references/rating.md");
    for (const file of files) {
      const text = readFileSync(join(skillDir, file), "utf8");
      expect(text, file).not.toContain("prompts/");
      expect(text, file).not.toContain("/Users/");
    }
  });

  test("every skill file keeps prose within 80 columns, frontmatter stripped", () => {
    for (const file of skillFiles()) {
      expect(longProseLines(readSkillText(file).text), file).toEqual([]);
    }
  });

  test("`description` covers every request the skill dispatches", () => {
    const description = /^description: (.*)$/m.exec(skill)?.[1] ?? "";
    for (const phrase of [
      "create a model registry for the first time",
      "add a platform or a model",
      "build or extend a profile",
      "record an accepted coverage gap",
      "refresh ratings",
    ]) {
      expect(description).toContain(phrase);
    }
  });

  test("SKILL.md dispatches to each reference, and each named reference exists", () => {
    const dispatch = body.section("Choose the path");
    expect(dispatch).not.toBe("");
    const named = new Set(
      [...dispatch.matchAll(/`(references\/[a-z-]+\.md)`/g)].map(([, path]) => path as string),
    );
    for (const path of named) {
      expect(existsSync(join(skillDir, path)), path).toBe(true);
    }
    const references = skillFiles().filter((file) => file.startsWith("references/"));
    expect([...named].sort()).toEqual(references);
    for (const path of [
      "references/new-registry.md",
      "references/build-profile.md",
      "references/gaps.md",
      "references/rating.md",
      "references/snapshots.md",
    ]) {
      expect(named.has(path), path).toBe(true);
    }
  });

  test("R4 narrow requests read existing facts and ask only for what is missing", () => {
    const dispatch = flat(body.section("Choose the path"));
    expect(dispatch).toContain("does not run the full interview");
    expect(dispatch).toContain("Read the existing facts in the target first");
    expect(dispatch).toContain("ask only for what the request needs and the file does not");
  });

  test("R7 Prerequisites chooses one invocation for every later command", () => {
    const prerequisites = flat(body.section("Prerequisites"));
    expect(prerequisites).toContain("Choose one invocation before the first command");
    expect(prerequisites).toContain("every command in this skill and its references");
    expect(prerequisites).toContain(
      "npx --yes --package=@dungle-scrubs/model-registry@latest model-registry",
    );
    expect(prerequisites).toContain(
      "npx --yes --package=@dungle-scrubs/model-router@latest model-router",
    );
    expect(prerequisites).toContain("means the chosen invocation with the same arguments");
    expect(prerequisites).toContain("`--registry <path>`");
  });

  test("R8 the opening names the one rating method in positive terms", () => {
    const opening = flat(body.lead);
    expect(opening).toContain("Use it for every rating, and use no other rating tool or engine");
    for (const file of skillFiles()) {
      expect(readSkillText(file).text, file).not.toContain("Jev");
    }
  });

  test("R8 SKILL.md stays short and leaves conditional detail to references", () => {
    expect(skill.split("\n").length).toBeLessThanOrEqual(150);
    for (const heading of [
      "## Step 1",
      "## Snapshots",
      "## Rebuilds and diffs",
      "## Gap records",
    ]) {
      expect(skill, heading).not.toContain(heading);
    }
  });
});

describe("the new-registry reference", () => {
  const reference = readSkillText("references/new-registry.md");

  /** The skeleton registry: the one fenced `json` block in the reference. */
  function skeleton(): unknown {
    const blocks = [...reference.text.matchAll(/```json\n([\s\S]*?)```/g)];
    expect(blocks).toHaveLength(1);
    return JSON.parse(blocks[0]?.[1] ?? "") as unknown;
  }

  test("R1 the skeleton loads with loadRegistry", async () => {
    const data = skeleton();
    await withTempDir((dir) => {
      const path = writeJson(dir, "registry.json", data);
      expect(() => loadRegistry({ path })).not.toThrow();
    });
  });

  test("R1 the skeleton holds every part model-router requires of a first file", () => {
    const data = skeleton() as {
      format: number;
      ratings: Record<string, string>;
      capabilities: Record<string, string>;
      router: { rank: string[] };
      tasks: Record<
        string,
        { description: string; minimums: Record<string, unknown>; rank: string[] }
      >;
      profiles: Record<string, { description: string; routes: string[] }>;
    };
    expect(data.format).toBe(1);
    expect(Object.keys(data.ratings).length).toBeGreaterThan(0);
    expect(Object.keys(data.capabilities).length).toBeGreaterThan(0);
    expect(data.router.rank.length).toBeGreaterThan(0);
    for (const name of data.router.rank) {
      expect(data.ratings[name], name).toBeDefined();
    }
    const tasks = Object.values(data.tasks);
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      expect(task.description).not.toBe("");
      expect(Object.keys(task.minimums).sort()).toEqual(["high", "low", "normal"]);
      expect(task.rank.length).toBeGreaterThan(0);
    }
    const profiles = Object.values(data.profiles);
    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      expect(profile.description).not.toBe("");
      expect(profile.routes.length).toBeGreaterThan(0);
    }
  });

  test("R1 the reference states the missing-file branch, the label formula and each part's source", () => {
    const text = flat(reference.text);
    expect(text).toContain("`registry-missing`");
    expect(text).toContain("Skip reading the target's existing shared facts");
    expect(text).toContain("Skip the rebuild in `references/snapshots.md`");
    expect(text).toContain("The rating handoff rates the draft's models and routes");
    expect(text).toContain("That list is `router.rank`");
    expect(text).toContain("Profile identity");
    expect(text).toContain("`model-a@harness-y/provider-1`");
    expect(text).toContain("never the `modelId`");
    for (const part of ["`format`", "`ratings`", "`capabilities`", "`router.rank`", "`tasks`"]) {
      expect(reference.section("The skeleton"), part).toContain(`| ${part} |`);
    }
    expect(flat(body.section("The target file"))).toContain("`registry-missing`");
  });
});
