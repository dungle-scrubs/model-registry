import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { runCli } from "../src/cli-run.js";
import { loadRegistry } from "../src/load-registry.js";
import {
  captureStream,
  createXdgConfigHome,
  examplePath,
  repoRoot,
  runBuiltCli,
  sha256Hex,
  withEnv,
  withTempDir,
  writeJson,
} from "./helpers.js";

vi.mock("../src/load-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/load-registry.js")>();
  return { ...actual, loadRegistry: vi.fn(actual.loadRegistry) };
});

const validRegistry = {
  format: 1,
  models: {
    "model-a": {
      family: "family-a",
      routes: [{ harness: "harness-x", modelId: "model-id-a", hosted: false }],
    },
  },
};

describe("the built CLI", () => {
  test("check on the example exits 0 with one JSON line", () => {
    const result = runBuiltCli(["check", "--registry", "examples/registry.json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("");
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, string>;
    expect(parsed.digest).toBe(`sha256:${sha256Hex(readFileSync(examplePath))}`);
  });

  test("--help exits 0 without reading a registry", () => {
    const result = runBuiltCli(["--help"], { MODEL_REGISTRY_FILE: "/nonexistent/registry.json" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: model-registry");
    expect(result.stdout).toContain("check");
  });

  test("--help lists the exit-code table", () => {
    const result = runBuiltCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Exit codes:");
    expect(result.stdout).toContain("0  the command succeeded");
    expect(result.stdout).toContain(
      "2  invalid usage (usage-invalid on stderr), or a migrate refusal because the backup",
    );
    expect(result.stdout).toContain("4  the registry file failed to load or validate");
  });

  test("check --help exits 0", () => {
    const result = runBuiltCli(["check", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("registry");
  });

  test("--version prints the package version", () => {
    const result = runBuiltCli(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`${packageJson.version}\n`);
  });

  test("no command exits 2 with usage-invalid", () => {
    const result = runBuiltCli([]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    const envelope = JSON.parse(result.stderr) as { error: { code: string; message: string } };
    expect(envelope.error.code).toBe("usage-invalid");
    expect(envelope.error.message).toContain("no command");
  });

  test("--registry given twice exits 2", () => {
    const result = runBuiltCli(["check", "--registry", "a.json", "--registry", "b.json"]);
    expect(result.exitCode).toBe(2);
    const envelope = JSON.parse(result.stderr) as { error: { code: string } };
    expect(envelope.error.code).toBe("usage-invalid");
  });

  test("an empty --registry value exits 2", () => {
    const result = runBuiltCli(["check", "--registry", ""]);
    expect(result.exitCode).toBe(2);
    const envelope = JSON.parse(result.stderr) as { error: { code: string } };
    expect(envelope.error.code).toBe("usage-invalid");
  });

  test("a missing file exits 4 with the loader envelope", () => {
    const missing = "/nonexistent/registry.json";
    const result = runBuiltCli(["check", "--registry", missing]);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("");
    expect(result.stderr.endsWith("\n")).toBe(true);
    const envelope = JSON.parse(result.stderr) as {
      error: { code: string; path: string; problems: unknown[] };
    };
    expect(envelope.error.code).toBe("registry-missing");
    // Windows path resolution turns the posix-looking argument into a
    // drive-qualified path, so compare against resolve, not the literal.
    expect(envelope.error.path).toBe(resolve(missing));
    expect(envelope.error.problems).toEqual([]);
  });

  test("an invalid registry exits 4 with every problem listed", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "invalid.json", {
        format: 1,
        models: {
          "model-a": {
            family: "family-a",
            extra: true,
            routes: [{ harness: "harness-x", modelId: "model-id-a" }],
          },
        },
      });
      const result = runBuiltCli(["check", "--registry", path]);
      expect(result.exitCode).toBe(4);
      const envelope = JSON.parse(result.stderr) as {
        error: { code: string; problems: { field: string }[] };
      };
      expect(envelope.error.code).toBe("registry-invalid");
      expect(envelope.error.problems).toHaveLength(2);
    });
  });

  test("check honors MODEL_REGISTRY_FILE without --registry", async () => {
    await withTempDir(async (dir) => {
      const path = writeJson(dir, "env-registry.json", validRegistry);
      const result = runBuiltCli(["check"], { MODEL_REGISTRY_FILE: path });
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { path: string };
      expect(parsed.path).toBe(path);
    });
  });

  test("check with no path anywhere resolves the XDG default", async () => {
    await withTempDir(async (dir) => {
      const configHome = createXdgConfigHome(dir, validRegistry);
      const result = runBuiltCli(["check"], {
        MODEL_REGISTRY_FILE: undefined,
        XDG_CONFIG_HOME: configHome,
      });
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { path: string };
      expect(parsed.path).toBe(join(configHome, "model-registry", "registry.json"));
    });
  });
});

describe("runCli in process", () => {
  test("an unexpected exception prints the internal-error envelope and exits 1", () => {
    vi.mocked(loadRegistry).mockImplementation(() => {
      throw new Error("boom");
    });
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["check", "--registry", "examples/registry.json"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(1);
    const envelope = JSON.parse(stderr.text()) as { error: { code: string; message: string } };
    expect(envelope.error.code).toBe("internal-error");
    expect(envelope.error.message).toBe("boom");
    vi.mocked(loadRegistry).mockRestore();
  });

  test("a loader failure prints the RegistryError envelope and exits 4", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["check", "--registry", join(repoRoot, "nope.json")], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(4);
    expect(stdout.text()).toBe("");
    const envelope = JSON.parse(stderr.text()) as { error: { code: string } };
    expect(envelope.error.code).toBe("registry-missing");
  });

  test("an unknown flag exits 2 with the usage fix in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["check", "--bogus"], { stdout: stdout.stream, stderr: stderr.stream });
    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stderr.text()) as {
      error: { code: string; message: string; fix: string };
    };
    expect(envelope.error.code).toBe("usage-invalid");
    expect(envelope.error.message).toBe("unknown option '--bogus'");
    expect(envelope.error.fix).toBe(
      "Run model-registry --help for the available commands and options.",
    );
  });

  test("no command exits 2 with the no-command fix in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli([], { stdout: stdout.stream, stderr: stderr.stream });
    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stderr.text()) as {
      error: { code: string; message: string; fix: string };
    };
    expect(envelope.error.code).toBe("usage-invalid");
    expect(envelope.error.message).toBe("no command was given.");
    expect(envelope.error.fix).toBe(
      "Run model-registry check, or model-registry --help for the available commands.",
    );
  });

  test("an unexpected exception prints the internal fix in process", () => {
    vi.mocked(loadRegistry).mockImplementation(() => {
      throw new Error("boom");
    });
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["check", "--registry", "examples/registry.json"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(1);
    const envelope = JSON.parse(stderr.text()) as { error: { fix: string } };
    expect(envelope.error.fix).toBe("Report this failure together with the command you ran.");
    vi.mocked(loadRegistry).mockRestore();
  });

  test("--help exits 0 with the command descriptions and the exit-code table in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["--help"], { stdout: stdout.stream, stderr: stderr.stream });
    expect(exitCode).toBe(0);
    expect(stderr.text()).toBe("");
    const text = stdout.text();
    expect(text).toContain("Usage: model-registry");
    expect(text).toContain("Load and validate a versioned model registry.");
    expect(text).toContain("Load a registry file and print its format, digest and path.");
    expect(text).toContain("Migrate a registry file to the current format, with a");
    expect(text).toContain("\n\nExit codes:");
    expect(text).toContain("Exit codes:");
    expect(text).toContain("0  the command succeeded");
  });

  test("migrate --help lists its options in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["migrate", "--help"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(0);
    const text = stdout.text();
    expect(text).toContain("--registry <path>");
    expect(text).toContain("path to the registry file");
    expect(text).toContain("--dry-run");
    expect(text).toContain("print the migrated file on stdout and write nothing");
  });

  test("--version exits 0 with a version line in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["--version"], { stdout: stdout.stream, stderr: stderr.stream });
    expect(exitCode).toBe(0);
    expect(stderr.text()).toBe("");
    expect(stdout.text()).toMatch(/^\d+\.\d+\.\d+\S*\n$/);
  });

  test("check prints its success line in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["check", "--registry", "examples/registry.json"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(0);
    expect(stdout.text()).toBe(
      `${JSON.stringify({
        format: 1,
        digest: `sha256:${sha256Hex(readFileSync(examplePath))}`,
        path: examplePath,
      })}\n`,
    );
  });

  test("--registry given twice exits 2 with the duplicate-path usage error in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["check", "--registry", "a.json", "--registry", "b.json"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stderr.text()) as {
      error: { code: string; message: string; fix: string };
    };
    expect(envelope.error.code).toBe("usage-invalid");
    expect(envelope.error.message).toBe("the --registry option was given more than once.");
    expect(envelope.error.fix).toBe("Give model-registry check exactly one --registry path.");
  });

  test("an empty --registry value exits 2 with the empty-path usage error in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["check", "--registry", ""], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stderr.text()) as {
      error: { code: string; message: string; fix: string };
    };
    expect(envelope.error.code).toBe("usage-invalid");
    expect(envelope.error.message).toBe("the --registry option was given an empty path.");
    expect(envelope.error.fix).toBe("Give --registry a non-empty path to a registry file.");
  });

  test("--registry given twice on migrate exits 2 naming migrate in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["migrate", "--registry", "a.json", "--registry", "b.json"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stderr.text()) as { error: { fix: string } };
    expect(envelope.error.fix).toBe("Give model-registry migrate exactly one --registry path.");
  });

  test("check with excess arguments exits 2 in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["check", "extra"], { stdout: stdout.stream, stderr: stderr.stream });
    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stderr.text()) as { error: { code: string } };
    expect(envelope.error.code).toBe("usage-invalid");
  });

  test("migrate with excess arguments exits 2 in process", () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const exitCode = runCli(["migrate", "extra"], { stdout: stdout.stream, stderr: stderr.stream });
    expect(exitCode).toBe(2);
    const envelope = JSON.parse(stderr.text()) as { error: { code: string } };
    expect(envelope.error.code).toBe("usage-invalid");
  });
});

describe("environment isolation", () => {
  test("the explicit path wins over the environment in one process", async () => {
    await withEnv({ MODEL_REGISTRY_FILE: "/nonexistent/from-env.json" }, () => {
      const stdout = captureStream();
      const stderr = captureStream();
      const exitCode = runCli(["check", "--registry", "examples/registry.json"], {
        stdout: stdout.stream,
        stderr: stderr.stream,
      });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.text()) as { path: string };
      // The separator is a backslash on Windows, so compare the resolved path.
      expect(parsed.path).toBe(resolve(repoRoot, "examples", "registry.json"));
    });
  });
});
