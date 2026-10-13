import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./helpers.js";

export const skillDir = join(repoRoot, "skills", "model-registry");

/** Every file under the skill directory, as paths relative to it. */
export function skillFiles(): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(skillDir, relative), { withFileTypes: true })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
      } else {
        found.push(path);
      }
    }
  };
  walk("");
  return found.sort();
}

/** Strip the YAML frontmatter from a skill file, if present. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) {
    return text;
  }
  const end = text.indexOf("\n---", 4);
  return end >= 0 ? text.slice(end + 4) : text;
}

/** Text with runs of whitespace collapsed to single spaces, so assertions
 * survive the prose's line wrapping. */
export function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

export interface SkillText {
  /** The file's text, frontmatter stripped. */
  readonly text: string;
  /** The opening, before the first `##` heading. */
  readonly lead: string;
  /** The text of one `##` section, from its heading to the next `##` heading. */
  section(title: string): string;
  /** The text of one `###` subsection, to the next `###` or `##` heading. */
  subsection(title: string): string;
}

/** Read one skill file, by its path relative to the skill directory. */
export function readSkillText(relative: string): SkillText {
  const text = stripFrontmatter(readFileSync(join(skillDir, relative), "utf8"));
  return {
    text,
    lead: text.split("\n## ")[0] ?? "",
    section(title: string): string {
      const start = text.indexOf(`## ${title}`);
      if (start < 0) {
        return "";
      }
      const rest = text.slice(start);
      const next = rest.indexOf("\n## ", 1);
      return next < 0 ? rest : rest.slice(0, next);
    },
    subsection(title: string): string {
      const start = text.indexOf(`### ${title}`);
      if (start < 0) {
        return "";
      }
      const rest = text.slice(start);
      const nextSub = rest.indexOf("\n### ", 1);
      const nextSec = rest.indexOf("\n## ", 1);
      const next = [nextSub, nextSec].filter((index) => index >= 0).sort((a, b) => a - b)[0];
      return next === undefined ? rest : rest.slice(0, next);
    },
  };
}

/** Prose lines longer than 80 columns, outside tables and code blocks. */
export function longProseLines(text: string): string[] {
  let inCode = false;
  const long: string[] = [];
  for (const line of text.split("\n")) {
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
  return long;
}
