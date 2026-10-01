import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CURRENT_FORMAT, type MigrateStep, runMigrate } from "../src/migrate.js";
import { withTempDir, writeJson } from "./helpers.js";

// The backup-write-then-replace flow cannot be driven to a mid-write
// failure with real files, so renameSync and writeFileSync are wrapped:
// both pass through to the real implementation unless a test overrides
// one call to fail.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

const mockedRename = vi.mocked(renameSync);
const mockedWrite = vi.mocked(writeFileSync);
const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");

const STEP_ZERO_TO_ONE: MigrateStep = (parsed) => ({ ...parsed, format: CURRENT_FORMAT });

afterEach(() => {
  mockedRename.mockReset();
  mockedRename.mockImplementation(actualFs.renameSync);
  mockedWrite.mockReset();
  mockedWrite.mockImplementation(actualFs.writeFileSync);
});

describe("a failed replacement", () => {
  test("a failed rename removes the temp file, keeps the backup and the original, and rethrows", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", { format: 0, models: {} });
      const original = readFileSync(path);
      mockedRename.mockImplementationOnce(() => {
        throw new Error("rename failed");
      });

      expect(() => runMigrate({ path, steps: [{ from: 0, step: STEP_ZERO_TO_ONE }] })).toThrow(
        "rename failed",
      );

      expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
      expect(readFileSync(path)).toEqual(original);
      const backupPath = join(dir, "registry.json.format-0.bak");
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(backupPath)).toEqual(original);
    });
  });

  test("a failed temp write removes the temp file, keeps the backup and the original, and rethrows", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", { format: 0, models: {} });
      const original = readFileSync(path);
      mockedWrite.mockImplementation((file, data, options) => {
        if (typeof file === "string" && file.endsWith(".tmp")) {
          // A partial temp file exists, as a mid-write disk-full failure leaves.
          actualFs.writeFileSync(file, "{ partial", options);
          throw new Error("disk full");
        }
        return actualFs.writeFileSync(file, data, options);
      });

      expect(() => runMigrate({ path, steps: [{ from: 0, step: STEP_ZERO_TO_ONE }] })).toThrow(
        "disk full",
      );

      expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
      expect(readFileSync(path)).toEqual(original);
      const backupPath = join(dir, "registry.json.format-0.bak");
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(backupPath)).toEqual(original);
    });
  });
});
