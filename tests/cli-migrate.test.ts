import { beforeEach, describe, expect, test, vi } from "vitest";
import { runCli } from "../src/cli-run.js";
import { RegistryError } from "../src/error.js";
import { runMigrate } from "../src/migrate.js";
import { captureStream, sha256Hex } from "./helpers.js";

// The built CLI reaches runMigrate only through the empty production step
// table, so the CLI's own branches (exit 2, the dry-run print, the success
// line) are driven here by stubbing the migrate module and running the real
// runCli in-process.
vi.mock("../src/migrate.js", () => ({ runMigrate: vi.fn() }));

const mockedRunMigrate = vi.mocked(runMigrate);

const REGISTRY_PATH = "/tmp/registry.json";
const BACKUP_PATH = "/tmp/registry.json.format-0.bak";

function runMigrateCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = runCli(args, { stdout: stdout.stream, stderr: stderr.stream });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

beforeEach(() => {
  mockedRunMigrate.mockReset();
});

describe("the migrate command's exit-code wiring", () => {
  test("a backup-exists RegistryError from runMigrate exits 2 with the envelope on stderr", () => {
    const error = new RegistryError({
      code: "backup-exists",
      fix: `Move or rename the backup at "${BACKUP_PATH}" so the next migrate can write its backup, then run model-registry migrate again.`,
      message: `a backup already exists at "${BACKUP_PATH}"`,
      path: REGISTRY_PATH,
      problems: [],
    });
    mockedRunMigrate.mockReturnValue({ kind: "error", error });

    const result = runMigrateCli(["migrate", "--registry", REGISTRY_PATH]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${JSON.stringify({ error: error.toJSON() })}\n`);
  });

  test("any other RegistryError from runMigrate exits 4 with the envelope on stderr", () => {
    const error = new RegistryError({
      code: "format-unsupported",
      fix: "Run model-registry migrate once a release ships the migration from format 0 to 1.",
      message: "format 0 is older than format 1 with no step to upgrade it",
      path: REGISTRY_PATH,
      problems: [],
    });
    mockedRunMigrate.mockReturnValue({ kind: "error", error });

    const result = runMigrateCli(["migrate", "--registry", REGISTRY_PATH]);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${JSON.stringify({ error: error.toJSON() })}\n`);
  });
});

describe("the migrate command's stdout wiring", () => {
  test("a dry-run outcome prints the migrated bytes exactly and exits 0", () => {
    const bytes = Buffer.from('{\n  "format": 1,\n  "models": {}\n}\n', "utf8");
    mockedRunMigrate.mockReturnValue({ kind: "dry-run", format: 1, path: REGISTRY_PATH, bytes });

    const result = runMigrateCli(["migrate", "--registry", REGISTRY_PATH, "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(bytes.toString("utf8"));
    expect(result.stderr).toBe("");
    expect(mockedRunMigrate).toHaveBeenCalledWith({ path: REGISTRY_PATH, dryRun: true });
  });

  test("an applied outcome prints the success record with the new digest and the backup", () => {
    const bytes = Buffer.from('{\n  "format": 1,\n  "models": {}\n}\n', "utf8");
    mockedRunMigrate.mockReturnValue({
      kind: "applied",
      format: 1,
      path: REGISTRY_PATH,
      bytes,
      backupPath: BACKUP_PATH,
      originalFormat: 0,
    });

    const result = runMigrateCli(["migrate", "--registry", REGISTRY_PATH]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `${JSON.stringify({
        format: 1,
        digest: `sha256:${sha256Hex(bytes)}`,
        path: REGISTRY_PATH,
        backup: BACKUP_PATH,
      })}\n`,
    );
    expect(result.stderr).toBe("");
  });
});
