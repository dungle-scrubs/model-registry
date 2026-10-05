import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { repoRoot } from "./helpers.js";

const rfc = readFileSync(
  join(repoRoot, "docs/rfc/02_registry-profiles-and-model-list-discovery.rfc.md"),
  "utf8",
);

function section(title: string): string {
  const start = rfc.indexOf(`### ${title}`);
  if (start < 0) return "";
  const rest = rfc.slice(start);
  const next = rest.search(/\n##[#]? /);
  return next < 0 ? rest : rest.slice(0, next);
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

const amendment = flat(section("Pinned benchmark reads"));

describe("the pinned-read RFC amendment", () => {
  test("82 1 records Kevin's dated decision with its normative source and release category", () => {
    expect(amendment).toContain("**Amendment, 2026-10-05 (Kevin).**");
    expect(amendment).toContain("Source:");
    expect(amendment).toContain("[t82]");
    expect(amendment).toContain("[t66]");
    expect(rfc).toContain("[Settle the pinned-read lifecycle for re-read benchmarks][t82]");
    expect(rfc).toContain("[t82]: https://github.com/dungle-scrubs/model-registry/issues/82");
    expect(rfc).toContain("[t66]: https://github.com/dungle-scrubs/model-registry/issues/66");
    expect(rfc).toMatch(/\| Settle the pinned-read lifecycle[^\n]+`model-registry` minor/);
  });

  test("82 1 base reads are saved beside the registry and matched by source and version", () => {
    for (const statement of [
      "`reads/` beside the target registry",
      "source and version",
      "saved when taken",
      "registry is written only after approval",
    ])
      expect(amendment).toContain(statement);
  });

  test("82 1 figures replace every model and route and name every declared profile", () => {
    for (const statement of [
      "every model that has one, not only the pool",
      "every declared profile whose ratings move",
      "every model and route in the registry",
      "keeps no figure from that benchmark",
      "Recompute every rating the benchmark feeds",
      "This also applies outside a profile build",
    ])
      expect(amendment).toContain(statement);
  });

  test("82 1 read files are immutable, safely named and removed only behind both gates", () => {
    for (const statement of [
      "reads are never overwritten",
      "names use lowercase letters, digits and hyphens only",
      "Lowercase the version and replace every other character with a hyphen",
      "never a credential, account id, email or path",
      "source, version and date",
      "only after the user approves and nothing in the registry names it",
      "<source-name>-<version>-<read-date>.json",
      "version appears once when it is the read date",
      "same read identity on the same date",
      "keep and use the existing read",
      "never before the registry write",
      "MUST NOT remove it unasked",
      "MAY be removed only after the user approves its removal",
      "MAY offer removal after the registry write",
      "rejected proposal or rejected bands",
      "registry unchanged",
    ])
      expect(amendment).toContain(statement);
    expect(amendment).not.toContain("MAY be offered for removal only after");
  });

  test("82 1 record-only keys keep their pinned read until the user approves moving them", () => {
    for (const statement of [
      "keeps its own pinned read when a benchmark sharing its source moves to a new read",
      "proposal lists it and asks whether to move it too",
      "On yes, its `version` and figures move",
      "on no, its `version`, figures and read file stay",
    ])
      expect(amendment).toContain(statement);
  });
});
