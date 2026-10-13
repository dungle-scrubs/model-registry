import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { repoRoot } from "./helpers.js";

const skillPath = join(repoRoot, "skills", "model-registry", "SKILL.md");
const ratingRefPath = join(repoRoot, "skills", "model-registry", "references", "rating.md");
const skill = readFileSync(skillPath, "utf8");
const ratingRef = readFileSync(ratingRefPath, "utf8");

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

  test("SKILL.md and references/rating.md do not mention `prompts/` or `/Users/`", () => {
    expect(skill).not.toContain("prompts/");
    expect(skill).not.toContain("/Users/");
    expect(ratingRef).not.toContain("prompts/");
    expect(ratingRef).not.toContain("/Users/");
  });
});
