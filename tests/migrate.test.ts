import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runCli } from "../src/cli-run.js";
import { RegistryError } from "../src/error.js";
import { loadRegistry } from "../src/load-registry.js";
import {
  applyMigrateSteps,
  CURRENT_FORMAT,
  type JsonObject,
  MIGRATE_STEPS,
  type MigrateStep,
  type MigrateStepEntry,
  runMigrate,
  serializeMigrated,
} from "../src/migrate.js";
import {
  captureStream,
  catchRegistryError,
  runBuiltCli,
  sha256Hex,
  withTempDir,
  writeJson,
} from "./helpers.js";

const VALID_REGISTRY = {
  format: 1,
  models: {
    "model-a": {
      family: "family-a",
      routes: [{ harness: "harness-x", modelId: "model-id-a", hosted: false }],
    },
  },
};

/** A synthetic step that lifts a format-0 registry to format 1. */
const STEP_ZERO_TO_ONE: MigrateStep = (parsed) => {
  return { ...parsed, format: CURRENT_FORMAT };
};

/** The same step as a table entry: the only entry a format-0 file needs. */
const FROM_ZERO: MigrateStepEntry = { from: 0, step: STEP_ZERO_TO_ONE };

function recordingStep(): { fn: MigrateStep; calls: JsonObject[] } {
  const calls: JsonObject[] = [];
  return {
    calls,
    fn: (parsed) => {
      const next: JsonObject = { ...parsed, format: (parsed.format as number) + 1 };
      calls.push(parsed);
      return next;
    },
  };
}

describe("applyMigrateSteps", () => {
  test("a table holding only a step from format 0 migrates a format 0 file", () => {
    const step = recordingStep();
    const parsed = { format: 0, models: {} };
    const migrated = applyMigrateSteps(parsed, [{ from: 0, step: step.fn }]);
    expect(migrated.format).toBe(1);
    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]).toEqual({ format: 0, models: {} });
    expect(migrated).not.toBe(parsed);
  });

  test("chains the entries a file passes through, in format order", () => {
    const parsed = { format: 0, models: {} };
    const migrated = applyMigrateSteps(
      parsed,
      [
        { from: 0, step: (p) => ({ ...p, format: 1 }) },
        { from: 1, step: (p) => ({ ...p, format: 2 }) },
      ],
      2,
    );
    expect(migrated.format).toBe(2);
  });

  test("skips an entry whose format the file never passes through", () => {
    const parsed = { format: 1, models: {} };
    const entry: MigrateStepEntry = {
      from: 0,
      step: (p) => ({ ...p, format: 1 }),
    };
    expect(applyMigrateSteps(parsed, [entry], 2)).toBe(parsed);
  });

  test("does not mutate the input object", () => {
    const parsed: JsonObject = { format: 0, models: {} };
    const snapshot = JSON.stringify(parsed);
    applyMigrateSteps(parsed, [{ from: 0, step: (p) => ({ ...p, format: 1 }) }]);
    expect(JSON.stringify(parsed)).toBe(snapshot);
  });

  test("returns the value when the format is already current", () => {
    const parsed = { format: 1, models: {} };
    expect(applyMigrateSteps(parsed, [])).toEqual({ format: 1, models: {} });
  });

  test("returns the value unchanged when no entry covers the format", () => {
    const parsed = { format: 0, models: {} };
    const migrated = applyMigrateSteps(parsed, []);
    expect(migrated.format).toBe(0);
  });
});

describe("serializeMigrated", () => {
  test("emits a 2-space indented payload plus a newline", () => {
    const bytes = serializeMigrated({ format: 1, models: {} });
    expect(bytes.toString("utf8")).toBe('{\n  "format": 1,\n  "models": {}\n}\n');
  });
});

describe("runMigrate error mapping", () => {
  test("a missing file gives registry-missing", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "missing.json");
      const outcome = runMigrate({ path });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error).toBeInstanceOf(RegistryError);
      expect(outcome.error.code).toBe("registry-missing");
      expect(outcome.error.path).toBe(path);
    });
  });

  test("a non-JSON file gives registry-unreadable", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "broken.json");
      writeFileSync(path, "{not json");
      const outcome = runMigrate({ path });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error.code).toBe("registry-unreadable");
    });
  });

  test("a newer format names upgrading model-registry", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "future.json", { format: 2, models: {} });
      const outcome = runMigrate({ path });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error.code).toBe("format-unsupported");
      expect(outcome.error.fix).toContain("Upgrade model-registry");
    });
  });

  test("an older format with no step names model-registry migrate", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "older.json", { format: 0, models: {} });
      const outcome = runMigrate({ path });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error.code).toBe("format-unsupported");
      expect(outcome.error.fix).toContain("Run model-registry migrate");
    });
  });
});

describe("a file with no usable format gets check's error", () => {
  test.each([
    ["a file with no format field", { models: {} }],
    ["a file whose root is an array", []],
    ["a file with a fractional format", { format: 1.5, models: {} }],
  ])("migrate and check report the same error for %s", async (_name, contents) => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", contents);
      const check = runBuiltCli(["check", "--registry", path]);
      expect(check.exitCode).toBe(4);
      const migrate = runBuiltCli(["migrate", "--registry", path]);
      expect(migrate.exitCode).toBe(4);
      expect(migrate.stderr).toBe(check.stderr);
    });
  });

  test("a formatless file fails with format-missing, not a migrate-specific error", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", { models: {} });
      const outcome = runMigrate({ path });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      const check = catchRegistryError(() => loadRegistry({ path }));
      expect(outcome.error.toJSON()).toEqual(check.toJSON());
      expect(outcome.error.code).toBe("format-missing");
    });
  });
});

describe("DW1 nothing to do on the current format", () => {
  test("runMigrate returns nothing-to-do on a format 1 file", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "current.json", VALID_REGISTRY);
      const before = readFileSync(path);
      const outcome = runMigrate({ path });
      expect(outcome).toEqual({ kind: "nothing-to-do", format: 1, path });
      expect(readFileSync(path)).toEqual(before);
    });
  });

  test("the CLI prints 'nothing to do' on stdout and exits 0", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "current.json", VALID_REGISTRY);
      const result = runBuiltCli(["migrate", "--registry", path]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("nothing to do\n");
      expect(result.stderr).toBe("");
    });
  });

  test("--dry-run on a format 1 file still says nothing to do", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "current.json", VALID_REGISTRY);
      const result = runBuiltCli(["migrate", "--registry", path, "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("nothing to do\n");
    });
  });
});

describe("DW2 a synthetic step migrates an older format end to end", () => {
  test("runMigrate writes the backup and replaces the file", async () => {
    await withTempDir(async (dir) => {
      const originalBytes = Buffer.from(
        JSON.stringify({
          format: 0,
          models: {
            "model-a": { family: "family-a", routes: [] },
          },
        }),
        "utf8",
      );
      const path = join(dir, "registry.json");
      writeFileSync(path, originalBytes);
      const outcome = runMigrate({ path, steps: [FROM_ZERO] });
      expect(outcome.kind).toBe("applied");
      if (outcome.kind !== "applied") return;
      expect(outcome.path).toBe(path);
      expect(outcome.originalFormat).toBe(0);
      const expectedBackup = join(dir, "registry.json.format-0.bak");
      expect(outcome.backupPath).toBe(expectedBackup);
      expect(existsSync(expectedBackup)).toBe(true);
      expect(readFileSync(expectedBackup)).toEqual(originalBytes);

      const replacedBytes = readFileSync(path);
      const parsed = JSON.parse(replacedBytes.toString("utf8")) as JsonObject;
      expect(parsed.format).toBe(1);

      const checked = loadRegistry({ path });
      expect(checked.format).toBe(1);
      expect(checked.registry.models["model-a"]).toBeDefined();
      expect(checked.digest).toBe(`sha256:${sha256Hex(replacedBytes)}`);
    });
  });

  test("the applied outcome carries the four fields the success line prints", async () => {
    await withTempDir(async (dir) => {
      const registry = { format: 0, models: { "model-a": { family: "family-a", routes: [] } } };
      const path = writeJson(dir, "registry.json", registry);
      const outcome = runMigrate({ path, steps: [FROM_ZERO] });
      expect(outcome).toEqual({
        kind: "applied",
        format: 1,
        path,
        bytes: Buffer.from(`${JSON.stringify({ ...registry, format: 1 }, null, 2)}\n`, "utf8"),
        backupPath: join(dir, "registry.json.format-0.bak"),
        originalFormat: 0,
      });
    });
  });
});

describe("DW3 an existing backup refuses and writes nothing", () => {
  test("runMigrate returns backup-exists and does not modify the file", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 0,
        models: { "model-a": { family: "family-a", routes: [] } },
      });
      const backupPath = join(dir, "registry.json.format-0.bak");
      const backupContent = Buffer.from("stale backup contents");
      writeFileSync(backupPath, backupContent);
      const fileBefore = readFileSync(path);
      const outcome = runMigrate({ path, steps: [FROM_ZERO] });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error.code).toBe("backup-exists");
      expect(outcome.error.message).toContain(backupPath);
      expect(outcome.error.fix).toContain(backupPath);
      expect(outcome.error.problems).toEqual([]);
      expect(outcome.error.path).toBe(path);
      expect(readFileSync(path)).toEqual(fileBefore);
      expect(readFileSync(backupPath)).toEqual(backupContent);
    });
  });

  test("runCli on a format-0 file with an existing backup exits 4 while no step ships", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 0,
        models: { "model-a": { family: "family-a", routes: [] } },
      });
      const backupPath = join(dir, "registry.json.format-0.bak");
      writeFileSync(backupPath, "stale");

      const stdout = captureStream();
      const stderr = captureStream();
      const exitCode = runCli(["migrate", "--registry", path], {
        stdout: stdout.stream,
        stderr: stderr.stream,
      });
      // The CLI uses the empty production step table, so a format-0 file
      // lands at format-unsupported exit 4, not the seam-driven exit 2
      // (cli-migrate.test.ts proves that wiring). The production CLI
      // cannot reach backup-exists until a step ships.
      expect(exitCode).toBe(4);
      const envelope = JSON.parse(stderr.text()) as { error: { code: string } };
      expect(envelope.error.code).toBe("format-unsupported");
      // Sanity: the backup and the file are untouched.
      expect(readFileSync(backupPath).toString("utf8")).toBe("stale");
    });
  });

  test("the backup-exists error serialises to the standard error envelope shape", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 0,
        models: { "model-a": { family: "family-a", routes: [] } },
      });
      const backupPath = join(dir, "registry.json.format-0.bak");
      writeFileSync(backupPath, "stale");
      const outcome = runMigrate({ path, steps: [FROM_ZERO] });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      const details = outcome.error.toJSON();
      expect(details.code).toBe("backup-exists");
      expect(details.path).toBe(path);
      expect(details.problems).toEqual([]);
      expect(details.message).toContain(backupPath);
      expect(details.fix).toContain(backupPath);
    });
  });
});

describe("DW4 --dry-run prints the migrated file and writes nothing", () => {
  test("runMigrate returns a dry-run result with the serialized bytes", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 0,
        models: { "model-a": { family: "family-a", routes: [] } },
      });
      const fileBefore = readFileSync(path);
      const outcome = runMigrate({ path, steps: [FROM_ZERO], dryRun: true });
      expect(outcome.kind).toBe("dry-run");
      if (outcome.kind !== "dry-run") return;
      expect(outcome.path).toBe(path);
      expect(outcome.format).toBe(1);
      expect(outcome.bytes.toString("utf8")).toBe(
        `${JSON.stringify({ format: 1, models: { "model-a": { family: "family-a", routes: [] } } }, null, 2)}\n`,
      );
      expect(readFileSync(path)).toEqual(fileBefore);
      expect(existsSync(`${path}.format-0.bak`)).toBe(false);
    });
  });

  test("the CLI --dry-run writes nothing to disk", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", VALID_REGISTRY);
      const fileBefore = readFileSync(path);
      const result = runBuiltCli(["migrate", "--registry", path, "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("nothing to do\n");
      expect(readFileSync(path)).toEqual(fileBefore);
      expect(existsSync(`${path}.format-1.bak`)).toBe(false);
    });
  });
});

describe("DW5 an invalid migrated result exits 4 and replaces nothing", () => {
  test("runMigrate returns the validation error before any write", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", { format: 0 });
      const fileBefore = readFileSync(path);
      const outcome = runMigrate({
        path,
        steps: [{ from: 0, step: (parsed) => ({ ...parsed, format: 1 }) }],
      });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error.code).toBe("registry-invalid");
      expect(outcome.error.problems.some((problem) => problem.field.endsWith('["models"]'))).toBe(
        true,
      );
      expect(readFileSync(path)).toEqual(fileBefore);
      expect(existsSync(`${path}.format-0.bak`)).toBe(false);
    });
  });
});

describe("CLI surface", () => {
  test("the migration command is listed in --help", () => {
    const result = runBuiltCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("migrate");
  });

  test("migrate --help exits 0 and lists its flags", () => {
    const result = runBuiltCli(["migrate", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--registry");
    expect(result.stdout).toContain("--dry-run");
  });

  test("an unknown flag exits 2 with usage-invalid", () => {
    const result = runBuiltCli(["migrate", "--bogus"]);
    expect(result.exitCode).toBe(2);
    const envelope = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(envelope.error.code).toBe("usage-invalid");
    expect(envelope.error.message).toContain("--bogus");
  });

  test("an empty --registry value exits 2 with usage-invalid", () => {
    const result = runBuiltCli(["migrate", "--registry", ""]);
    expect(result.exitCode).toBe(2);
    const envelope = JSON.parse(result.stderr) as { error: { code: string } };
    expect(envelope.error.code).toBe("usage-invalid");
  });

  test("the production CLI rejects a newer format with exit 4", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "future.json", { format: 2, models: {} });
      const result = runBuiltCli(["migrate", "--registry", path]);
      expect(result.exitCode).toBe(4);
      const envelope = JSON.parse(result.stderr) as { error: { code: string; fix: string } };
      expect(envelope.error.code).toBe("format-unsupported");
      expect(envelope.error.fix).toContain("Upgrade model-registry");
    });
  });

  test("runMigrate returns backup-exists through the injected step seam", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 0,
        models: { "model-a": { family: "family-a", routes: [] } },
      });
      const backupPath = join(dir, "registry.json.format-0.bak");
      writeFileSync(backupPath, "stale");
      const fileBefore = readFileSync(path);
      const backupBefore = readFileSync(backupPath);
      // Drive the seam through runMigrate directly: when a step table
      // produces an applied result and the backup is already there,
      // runMigrate refuses before writing anything.
      const outcome = runMigrate({ path, steps: [FROM_ZERO] });
      expect(outcome.kind).toBe("error");
      if (outcome.kind !== "error") return;
      expect(outcome.error.code).toBe("backup-exists");
      expect(outcome.error.toJSON()).toMatchObject({
        code: "backup-exists",
        path,
        problems: [],
      });
      expect(readFileSync(path)).toEqual(fileBefore);
      expect(readFileSync(backupPath)).toEqual(backupBefore);
    });
  });
});

describe("atomic replace", () => {
  test("the file is the migrated bytes and the backup is the original bytes", async () => {
    await withTempDir(async (dir) => {
      const original = JSON.stringify({
        format: 0,
        models: { "model-a": { family: "family-a", routes: [] } },
      });
      const path = join(dir, "registry.json");
      writeFileSync(path, original);
      const originalBytes = readFileSync(path);
      runMigrate({ path, steps: [{ from: 0, step: (p) => ({ ...p, format: 1 }) }] });
      const backupPath = join(dir, "registry.json.format-0.bak");
      expect(readFileSync(backupPath)).toEqual(originalBytes);
      const newBytes = readFileSync(path);
      expect(newBytes).not.toEqual(originalBytes);
      expect(JSON.parse(newBytes.toString("utf8")).format).toBe(1);
    });
  });

  test("no temp file is left beside the registry after success", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "registry.json", {
        format: 0,
        models: { "model-a": { family: "family-a", routes: [] } },
      });
      runMigrate({ path, steps: [{ from: 0, step: (p) => ({ ...p, format: 1 }) }] });
      const entries = readdirSync(dir);
      expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false);
    });
  });

  test("the backup name keeps a backslash in the file name", async () => {
    await withTempDir(async (dir) => {
      // On POSIX a backslash is a legal file-name character, so the
      // backup must be named from the whole file name.
      const path = join(dir, "weird\\name.json");
      writeFileSync(path, JSON.stringify({ format: 0, models: {} }));
      const outcome = runMigrate({ path, steps: [FROM_ZERO] });
      expect(outcome).toMatchObject({
        kind: "applied",
        backupPath: join(dir, "weird\\name.json.format-0.bak"),
      });
      expect(existsSync(join(dir, "weird\\name.json.format-0.bak"))).toBe(true);
      expect(existsSync(join(dir, "name.json.format-0.bak"))).toBe(false);
    });
  });
});

describe("production step table", () => {
  test("the production table is empty in this release", () => {
    expect(MIGRATE_STEPS).toEqual([]);
  });

  test("the production table is exported from the source", async () => {
    const mod = (await import("../src/migrate.js")) as {
      MIGRATE_STEPS: readonly MigrateStepEntry[];
    };
    expect(mod.MIGRATE_STEPS).toEqual([]);
  });
});
