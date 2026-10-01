import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runCli } from "../src/cli-run.js";
import { CURRENT_FORMAT, type MigrateStepEntry } from "../src/migrate.js";
import { captureStream, sha256Hex, withTempDir, writeJson } from "./helpers.js";

const FROM_ZERO: MigrateStepEntry = {
  from: 0,
  step: (parsed) => ({ ...parsed, format: CURRENT_FORMAT }),
};

const VALID_REGISTRY = {
  format: 1,
  models: {
    "model-a": {
      family: "family-a",
      routes: [{ harness: "harness-x", modelId: "model-id-a", hosted: false }],
    },
  },
};

function runMigrateCli(
  args: string[],
  steps: readonly MigrateStepEntry[] = [],
): { exitCode: number; stdout: string; stderr: string } {
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = runCli(args, { stdout: stdout.stream, stderr: stderr.stream }, { steps });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

describe("the migrate command's exit-code wiring", () => {
  test("a backup that already exists exits 2 with the envelope on stderr", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 0,
        models: { "model-a": { family: "family-a", routes: [] } },
      });
      writeFileSync(join(dir, "registry.json.format-0.bak"), "stale");
      const fileBefore = readFileSync(path);

      const result = runMigrateCli(["migrate", "--registry", path], [FROM_ZERO]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      const envelope = JSON.parse(result.stderr) as { error: { code: string; path: string } };
      expect(envelope.error.code).toBe("backup-exists");
      expect(envelope.error.path).toBe(path);
      expect(readFileSync(path)).toEqual(fileBefore);
    });
  });

  test("a format the release cannot load exits 4 with the envelope on stderr", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", { format: 2, models: {} });

      const result = runMigrateCli(["migrate", "--registry", path], [FROM_ZERO]);

      expect(result.exitCode).toBe(4);
      expect(result.stdout).toBe("");
      const envelope = JSON.parse(result.stderr) as { error: { code: string; fix: string } };
      expect(envelope.error.code).toBe("format-unsupported");
      expect(envelope.error.fix).toContain("Upgrade model-registry");
    });
  });
});

describe("the migrate command's stdout wiring", () => {
  test("without --dry-run the file is replaced and the success line is printed", async () => {
    await withTempDir(async (dir) => {
      const registry = { format: 0, models: { "model-a": { family: "family-a", routes: [] } } };
      const path = writeJson(dir, "registry.json", registry);
      const migrated = `${JSON.stringify({ ...registry, format: 1 }, null, 2)}\n`;
      const digest = `sha256:${sha256Hex(Buffer.from(migrated, "utf8"))}`;

      const result = runMigrateCli(["migrate", "--registry", path], [FROM_ZERO]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(
        `${JSON.stringify({
          format: 1,
          digest,
          path,
          backup: join(realpathSync(dir), "registry.json.format-0.bak"),
        })}\n`,
      );
      expect(readFileSync(path).toString("utf8")).toBe(migrated);
      expect(readFileSync(join(dir, "registry.json.format-0.bak")).toString("utf8")).toBe(
        `${JSON.stringify(registry, null, 2)}\n`,
      );
    });
  });

  test("--dry-run prints the migrated bytes and writes nothing", async () => {
    await withTempDir(async (dir) => {
      const registry = { format: 0, models: { "model-a": { family: "family-a", routes: [] } } };
      const path = writeJson(dir, "registry.json", registry);
      const fileBefore = readFileSync(path);
      const migrated = `${JSON.stringify({ ...registry, format: 1 }, null, 2)}\n`;

      const result = runMigrateCli(["migrate", "--registry", path, "--dry-run"], [FROM_ZERO]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(migrated);
      expect(readFileSync(path)).toEqual(fileBefore);
      expect(existsSync(join(dir, "registry.json.format-0.bak"))).toBe(false);
    });
  });

  test("--dry-run on a current file prints nothing to do", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "current.json", VALID_REGISTRY);
      const fileBefore = readFileSync(path);

      const result = runMigrateCli(["migrate", "--registry", path, "--dry-run"], []);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("nothing to do\n");
      expect(readFileSync(path)).toEqual(fileBefore);
    });
  });
});
