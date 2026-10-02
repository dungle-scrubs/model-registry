import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CURRENT_FORMAT, type MigrateStep, runMigrate } from "../src/migrate.js";
import { withTempDir, writeJson } from "./helpers.js";

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

describe("a failed backup write", () => {
  test("a failure after the backup file opens removes the partial backup, keeps the original, and rethrows", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", { format: 0, models: {} });
      const original = readFileSync(path);
      mockedWrite.mockImplementation((file, data, options) => {
        if (typeof file === "string" && file.endsWith(".format-0.bak")) {
          actualFs.writeFileSync(file, "{ partial backup", options);
          throw new Error("disk full during the backup write");
        }
        return actualFs.writeFileSync(file, data, options);
      });

      expect(() => runMigrate({ path, steps: [{ from: 0, step: STEP_ZERO_TO_ONE }] })).toThrow(
        "disk full during the backup write",
      );

      expect(readFileSync(path)).toEqual(original);
      expect(existsSync(join(dir, "registry.json.format-0.bak"))).toBe(false);
      expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
    });
  });
});

describe("the temp file write", () => {
  test.skipIf(process.platform === "win32")(
    "creates the temp file exclusively with the registry's mode, then chmods it into place",
    async () => {
      await withTempDir(async (dir) => {
        const path = writeJson(dir, "registry.json", { format: 0, models: {} });
        chmodSync(path, 0o600);
        const tempOptions: unknown[] = [];
        mockedWrite.mockImplementation((file, data, options) => {
          if (typeof file === "string" && file.endsWith(".tmp")) {
            tempOptions.push(options);
          }
          return actualFs.writeFileSync(file, data, options);
        });

        runMigrate({ path, steps: [{ from: 0, step: STEP_ZERO_TO_ONE }] });

        expect(tempOptions).toEqual([{ flag: "wx", mode: 0o600 }]);
        expect(statSync(path).mode & 0o777).toBe(0o600);
      });
    },
  );
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
