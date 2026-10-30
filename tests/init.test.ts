import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import intakeSchema from "../intake.schema.json" with { type: "json" };
import { runCli } from "../src/cli-run.js";
import { runInit, validateHarnessName } from "../src/init.js";
import { BENCHMARK_CATALOG, OTHER_HARNESS_ID } from "../src/init-catalog.js";
import {
  InitCancelled,
  type InitConfirmRequest,
  type InitMultiselectRequest,
  type InitPasswordRequest,
  type InitPrompts,
  type InitSelectRequest,
  type InitSpinner,
  type InitTextRequest,
} from "../src/init-prompts.js";
import { starterRegistry } from "../src/starter.js";
import { validateRegistry } from "../src/validate.js";
import { captureStream, repoRoot, runBuiltCli, withTempDir } from "./helpers.js";

const ratingReference = readFileSync(
  join(repoRoot, "skills", "model-registry", "references", "rating.md"),
  "utf8",
);

const HARNESSES = ["claude", "codex", "cursor", "pi", "antigravity", "muse"] as const;

const modelRouterCli = join(
  repoRoot,
  "node_modules",
  "@dungle-scrubs",
  "model-router",
  "dist",
  "cli.js",
);

const intakeValidate = new Ajv2020({ allErrors: true, strictNumbers: true }).compile(intakeSchema);

interface ScriptedAnswers {
  readonly harnesses?: readonly string[];
  readonly otherHarness?: string;
  readonly hasKey?: boolean;
  readonly key?: string;
  readonly keepKey?: boolean;
  readonly benchmarks?: readonly string[];
  readonly cancelAt?: "harnesses" | "key" | "benchmarks";
}

/** A wizard UI that answers from a script, so the flow runs with no terminal. */
class ScriptedPrompts implements InitPrompts {
  readonly messages: string[] = [];
  readonly multiselectRequests: InitMultiselectRequest<unknown>[] = [];
  private multiselectCalls = 0;

  constructor(private readonly answers: ScriptedAnswers = {}) {}

  intro(message: string): void {
    this.messages.push(message);
  }

  outro(message: string): void {
    this.messages.push(message);
  }

  cancel(message: string): void {
    this.messages.push(message);
  }

  async group<T>(_label: string, body: () => Promise<T>): Promise<T> {
    return body();
  }

  async multiselect<T>(request: InitMultiselectRequest<T>): Promise<T[]> {
    this.multiselectCalls += 1;
    this.multiselectRequests.push(request as InitMultiselectRequest<unknown>);
    if (this.multiselectCalls === 1) {
      if (this.answers.cancelAt === "harnesses") {
        throw new InitCancelled();
      }
      return [...(this.answers.harnesses ?? [])] as T[];
    }
    if (this.answers.cancelAt === "benchmarks") {
      throw new InitCancelled();
    }
    return [...(this.answers.benchmarks ?? [])] as T[];
  }

  async select<T>(_request: InitSelectRequest<T>): Promise<T> {
    return ((this.answers.keepKey ?? true) ? "keep" : "replace") as T;
  }

  async confirm(_request: InitConfirmRequest): Promise<boolean> {
    return this.answers.hasKey ?? false;
  }

  async text(_request: InitTextRequest): Promise<string> {
    return this.answers.otherHarness ?? "other-harness";
  }

  async password(_request: InitPasswordRequest): Promise<string> {
    if (this.answers.cancelAt === "key") {
      throw new InitCancelled();
    }
    return this.answers.key ?? "";
  }

  spinner(): InitSpinner {
    return { start: () => {}, stop: () => {} };
  }
}

function writeRegistryFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function modelRouterCheck(path: string, configHome: string): { status: number; stdout: string } {
  const result = spawnSync(process.execPath, [modelRouterCli, "check", "--registry", path], {
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, XDG_CONFIG_HOME: configHome, MODEL_ROUTER_CONFIG: undefined },
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "" };
}

describe("the starter registry", () => {
  for (const harness of HARNESSES) {
    test(`the starter registry for ${harness} passes the validator and model-router check`, async () => {
      await withTempDir(async (dir) => {
        const registry = starterRegistry([harness]);
        const validated = validateRegistry(registry);
        expect(validated.ok, JSON.stringify(validated.ok ? [] : validated.problems)).toBe(true);
        const path = join(dir, "registry.json");
        writeRegistryFile(path, registry);
        const check = modelRouterCheck(path, join(dir, "xdg"));
        expect(check.status, check.stdout).toBe(0);
      });
    });
  }

  test("the starter registry for every harness passes the validator and model-router check", async () => {
    await withTempDir(async (dir) => {
      const registry = starterRegistry(HARNESSES);
      const validated = validateRegistry(registry);
      expect(validated.ok, JSON.stringify(validated.ok ? [] : validated.problems)).toBe(true);
      const path = join(dir, "registry.json");
      writeRegistryFile(path, registry);
      const check = modelRouterCheck(path, join(dir, "xdg"));
      expect(check.status, check.stdout).toBe(0);
    });
  });

  test("the starter registry names every route label in its default profile", () => {
    const registry = starterRegistry(HARNESSES) as unknown as {
      profiles: Record<string, { routes: string[] }>;
      models: Record<string, { routes: { harness: string }[] }>;
    };
    expect(registry.profiles.default?.routes).toEqual([
      "example-model@claude",
      "example-model@codex",
      "example-model@cursor",
      "example-model@pi",
      "example-model@antigravity",
      "example-model@muse",
    ]);
    expect(registry.models["example-model"]?.routes.map((route) => route.harness)).toEqual([
      ...HARNESSES,
    ]);
  });
});

describe("the init wizard", () => {
  test("the starter path writes a valid registry and no intake", async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, "registry.json");
      const outcome = await runInit({
        registryPath: target,
        env: { XDG_CONFIG_HOME: join(dir, "xdg") },
        prompts: new ScriptedPrompts({ harnesses: ["claude"], benchmarks: [] }),
        isTty: true,
      });
      expect(outcome.kind).toBe("starter");
      expect(existsSync(target)).toBe(true);
      expect(existsSync(join(dir, "intake.json"))).toBe(false);
      const parsed = JSON.parse(readFileSync(target, "utf8")) as unknown;
      const validated = validateRegistry(parsed);
      expect(validated.ok, JSON.stringify(validated.ok ? [] : validated.problems)).toBe(true);
    });
  });

  test("the intake path writes a schema-valid intake and no registry", async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, "registry.json");
      const outcome = await runInit({
        registryPath: target,
        env: { XDG_CONFIG_HOME: join(dir, "xdg") },
        prompts: new ScriptedPrompts({
          harnesses: ["claude", "pi"],
          benchmarks: ["aa-intelligence", "arena-webdev"],
        }),
        isTty: true,
      });
      expect(outcome.kind).toBe("intake");
      expect(existsSync(target)).toBe(false);
      const intakePath = join(dir, "intake.json");
      expect(existsSync(intakePath)).toBe(true);
      const intake = JSON.parse(readFileSync(intakePath, "utf8")) as unknown;
      expect(intakeValidate(intake), JSON.stringify(intakeValidate.errors)).toBe(true);
      expect(intake).toMatchObject({
        format: 1,
        harnesses: ["claude", "pi"],
        artificialAnalysisKey: "none",
        benchmarks: ["aa-intelligence", "arena-webdev"],
      });
    });
  });

  test("an existing target refuses and is never overwritten", async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, "registry.json");
      writeFileSync(target, '{\n  "format": 1\n}\n');
      const outcome = await runInit({
        registryPath: target,
        env: { XDG_CONFIG_HOME: join(dir, "xdg") },
        prompts: new ScriptedPrompts({ harnesses: ["claude"] }),
        isTty: true,
      });
      expect(outcome.kind).toBe("refused");
      expect(outcome.kind === "refused" ? outcome.message : "").toContain(target);
      expect(readFileSync(target, "utf8")).toBe('{\n  "format": 1\n}\n');
    });
  });

  test("no terminal refuses before any question is asked", async () => {
    await withTempDir(async (dir) => {
      const prompts = new ScriptedPrompts({ harnesses: ["claude"] });
      const outcome = await runInit({
        registryPath: join(dir, "registry.json"),
        env: { XDG_CONFIG_HOME: join(dir, "xdg") },
        prompts,
        isTty: false,
      });
      expect(outcome.kind).toBe("refused");
      expect(prompts.messages).toEqual([]);
      expect(existsSync(join(dir, "registry.json"))).toBe(false);
    });
  });

  test("cancelling at any prompt writes nothing", async () => {
    for (const cancelAt of ["harnesses", "key", "benchmarks"] as const) {
      await withTempDir(async (dir) => {
        const prompts = new ScriptedPrompts({
          harnesses: ["claude"],
          hasKey: true,
          key: "test-key-value",
          benchmarks: ["aa-intelligence"],
          cancelAt,
        });
        const outcome = await runInit({
          registryPath: join(dir, "registry.json"),
          env: { XDG_CONFIG_HOME: join(dir, "xdg") },
          prompts,
          isTty: true,
        });
        expect(outcome.kind, cancelAt).toBe("cancelled");
        expect(prompts.messages).toContain("cancelled, nothing written");
        expect(existsSync(join(dir, "registry.json"))).toBe(false);
        expect(existsSync(join(dir, "intake.json"))).toBe(false);
        expect(existsSync(join(dir, "xdg", "model-registry", "artificial-analysis.env"))).toBe(
          false,
        );
      });
    }
  });

  test("the key file holds one line, mode 0600, in a mode 0700 directory", async () => {
    await withTempDir(async (dir) => {
      const configHome = join(dir, "xdg");
      const outcome = await runInit({
        registryPath: join(dir, "registry.json"),
        env: { XDG_CONFIG_HOME: configHome },
        prompts: new ScriptedPrompts({
          harnesses: ["claude"],
          hasKey: true,
          key: "test-key-value",
          benchmarks: ["aa-intelligence"],
        }),
        isTty: true,
      });
      expect(outcome.kind).toBe("intake");
      const keyFile = join(configHome, "model-registry", "artificial-analysis.env");
      expect(existsSync(keyFile)).toBe(true);
      expect(statSync(keyFile).mode & 0o777).toBe(0o600);
      expect(statSync(join(configHome, "model-registry")).mode & 0o777).toBe(0o700);
      expect(readFileSync(keyFile, "utf8")).toBe("ARTIFICIAL_ANALYSIS_API_KEY=test-key-value\n");
    });
  });

  test("an existing key file is kept when the user keeps it", async () => {
    await withTempDir(async (dir) => {
      const configHome = join(dir, "xdg");
      const keyFile = join(configHome, "model-registry", "artificial-analysis.env");
      mkdirSync(join(configHome, "model-registry"), { recursive: true });
      writeFileSync(keyFile, "ARTIFICIAL_ANALYSIS_API_KEY=kept-key\n");
      const outcome = await runInit({
        registryPath: join(dir, "registry.json"),
        env: { XDG_CONFIG_HOME: configHome },
        prompts: new ScriptedPrompts({
          harnesses: ["claude"],
          hasKey: true,
          keepKey: true,
          benchmarks: ["aa-intelligence"],
        }),
        isTty: true,
      });
      expect(outcome.kind).toBe("intake");
      expect(readFileSync(keyFile, "utf8")).toBe("ARTIFICIAL_ANALYSIS_API_KEY=kept-key\n");
    });
  });

  test("the key never reaches the intake, the registry or the wizard's output", async () => {
    await withTempDir(async (dir) => {
      const stdout = captureStream();
      const stderr = captureStream();
      const prompts = new ScriptedPrompts({
        harnesses: ["claude"],
        hasKey: true,
        key: "test-key-value",
        benchmarks: ["aa-intelligence"],
      });
      const exitCode = await runCli(
        ["init", "--registry", join(dir, "registry.json")],
        { stdout: stdout.stream, stderr: stderr.stream },
        { prompts, isTty: true },
      );
      expect(exitCode).toBe(0);
      const intake = readFileSync(join(dir, "intake.json"), "utf8");
      expect(intake).not.toContain("test-key-value");
      expect(intake).toContain('"artificialAnalysisKey": "saved"');
      expect(stdout.text()).not.toContain("test-key-value");
      expect(stderr.text()).not.toContain("test-key-value");
      for (const message of prompts.messages) {
        expect(message).not.toContain("test-key-value");
      }
    });
  });
});

describe("the init command in the CLI", () => {
  test("the starter path exits 0", async () => {
    await withTempDir(async (dir) => {
      const stdout = captureStream();
      const stderr = captureStream();
      const exitCode = await runCli(
        ["init", "--registry", join(dir, "registry.json")],
        { stdout: stdout.stream, stderr: stderr.stream },
        {
          prompts: new ScriptedPrompts({ harnesses: ["claude"], benchmarks: [] }),
          isTty: true,
        },
      );
      expect(exitCode).toBe(0);
      expect(stderr.text()).toBe("");
      expect(existsSync(join(dir, "registry.json"))).toBe(true);
    });
  });

  test("a refusal exits 2 with the usage-invalid envelope", async () => {
    await withTempDir(async (dir) => {
      const stdout = captureStream();
      const stderr = captureStream();
      const exitCode = await runCli(
        ["init", "--registry", join(dir, "registry.json")],
        { stdout: stdout.stream, stderr: stderr.stream },
        { prompts: new ScriptedPrompts({ harnesses: ["claude"] }), isTty: false },
      );
      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stderr.text()) as { error: { code: string; message: string } };
      expect(envelope.error.code).toBe("usage-invalid");
      expect(envelope.error.message).toContain("terminal");
    });
  });

  test("cancelling exits 130", async () => {
    await withTempDir(async (dir) => {
      const stdout = captureStream();
      const stderr = captureStream();
      const exitCode = await runCli(
        ["init", "--registry", join(dir, "registry.json")],
        { stdout: stdout.stream, stderr: stderr.stream },
        {
          prompts: new ScriptedPrompts({
            harnesses: ["claude"],
            cancelAt: "benchmarks",
          }),
          isTty: true,
        },
      );
      expect(exitCode).toBe(130);
      expect(existsSync(join(dir, "registry.json"))).toBe(false);
    });
  });

  test("--registry given twice exits 2", async () => {
    await withTempDir(async () => {
      const stdout = captureStream();
      const stderr = captureStream();
      const exitCode = await runCli(
        ["init", "--registry", "a.json", "--registry", "b.json"],
        { stdout: stdout.stream, stderr: stderr.stream },
        { prompts: new ScriptedPrompts({ harnesses: ["claude"] }), isTty: true },
      );
      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stderr.text()) as { error: { message: string } };
      expect(envelope.error.message).toContain("more than once");
    });
  });
});

describe("the built init command", () => {
  test("it refuses without a terminal", async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, "registry.json");
      const result = runBuiltCli(["init", "--registry", target]);
      expect(result.exitCode).toBe(2);
      const envelope = JSON.parse(result.stderr) as { error: { code: string; message: string } };
      expect(envelope.error.code).toBe("usage-invalid");
      expect(envelope.error.message).toContain("terminal");
      expect(existsSync(target)).toBe(false);
    });
  });

  test("--help lists the command and its option", async () => {
    const result = runBuiltCli(["init", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--registry <path>");
    expect(result.stdout).toContain("path to the registry file");
  });
});

describe("the harness and benchmark catalogs", () => {
  test("every benchmark id in the catalog has a suggestion in the rating method", () => {
    for (const entry of BENCHMARK_CATALOG) {
      expect(ratingReference, entry.id).toContain(`\`${entry.id}\``);
    }
  });

  test("the harness list offers the known harnesses and Other, with nothing preselected", async () => {
    await withTempDir(async (dir) => {
      const prompts = new ScriptedPrompts({ harnesses: ["claude"], benchmarks: [] });
      await runInit({
        registryPath: join(dir, "registry.json"),
        env: { XDG_CONFIG_HOME: join(dir, "xdg") },
        prompts,
        isTty: true,
      });
      const request = prompts.multiselectRequests[0];
      expect(request?.options.map((option) => option.value)).toEqual([
        "claude",
        "codex",
        "cursor",
        "pi",
        "antigravity",
        "muse",
        OTHER_HARNESS_ID,
      ]);
      expect(request?.initialValues).toEqual([]);
      expect(request?.required).toBe(true);
    });
  });

  test("a saved key offers the Artificial Analysis benchmarks and preselects them", async () => {
    await withTempDir(async (dir) => {
      const prompts = new ScriptedPrompts({
        harnesses: ["claude"],
        hasKey: true,
        key: "test-key-value",
        benchmarks: [],
      });
      await runInit({
        registryPath: join(dir, "registry.json"),
        env: { XDG_CONFIG_HOME: join(dir, "xdg") },
        prompts,
        isTty: true,
      });
      const request = prompts.multiselectRequests[1];
      expect(request?.options.map((option) => option.value)).toEqual([
        "aa-intelligence",
        "aa-cost",
        "epoch-eci",
        "livebench-coding",
        "terminal-bench",
        "openrouter-pricing",
        "livebench-cost",
        "arena-webdev",
      ]);
      expect(request?.initialValues).toEqual([
        "aa-intelligence",
        "aa-cost",
        "livebench-coding",
        "arena-webdev",
      ]);
    });
  });

  test("without a key the Artificial Analysis benchmarks are hidden and the keyless ones are preselected", async () => {
    await withTempDir(async (dir) => {
      const prompts = new ScriptedPrompts({ harnesses: ["claude"], benchmarks: [] });
      await runInit({
        registryPath: join(dir, "registry.json"),
        env: { XDG_CONFIG_HOME: join(dir, "xdg") },
        prompts,
        isTty: true,
      });
      const request = prompts.multiselectRequests[1];
      expect(request?.options.map((option) => option.value)).toEqual([
        "epoch-eci",
        "livebench-coding",
        "terminal-bench",
        "openrouter-pricing",
        "livebench-cost",
        "arena-webdev",
      ]);
      expect(request?.initialValues).toEqual([
        "epoch-eci",
        "livebench-coding",
        "openrouter-pricing",
        "arena-webdev",
      ]);
    });
  });

  test("a harness name the user types is lowercase letters, digits and hyphens", () => {
    expect(validateHarnessName("my-harness")).toBeUndefined();
    expect(validateHarnessName("harness2")).toBeUndefined();
    expect(validateHarnessName("")).toContain("Give the harness a name");
    expect(validateHarnessName("My-Harness")).toContain("lowercase");
    expect(validateHarnessName("my_harness")).toContain("lowercase");
    expect(validateHarnessName("my harness")).toContain("lowercase");
  });

  test("choosing no harness refuses", async () => {
    await withTempDir(async (dir) => {
      const outcome = await runInit({
        registryPath: join(dir, "registry.json"),
        env: { XDG_CONFIG_HOME: join(dir, "xdg") },
        prompts: new ScriptedPrompts({ harnesses: [] }),
        isTty: true,
      });
      expect(outcome.kind).toBe("refused");
      expect(existsSync(join(dir, "registry.json"))).toBe(false);
    });
  });

  test("the Other option is not a name a user can type", async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, "registry.json");
      const outcome = await runInit({
        registryPath: target,
        env: { XDG_CONFIG_HOME: join(dir, "xdg") },
        prompts: new ScriptedPrompts({
          harnesses: [OTHER_HARNESS_ID],
          otherHarness: "my-harness",
          benchmarks: [],
        }),
        isTty: true,
      });
      expect(outcome.kind).toBe("starter");
      const registry = JSON.parse(readFileSync(target, "utf8")) as {
        models: Record<string, { routes: { harness: string }[] }>;
      };
      expect(registry.models["example-model"]?.routes[0]?.harness).toBe("my-harness");
    });
  });
});
