import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import intakeSchema from "../intake.schema.json" with { type: "json" };
import {
  HARNESS_CATALOG,
  OTHER_HARNESS_ID,
  offeredBenchmarks,
  recommendedBenchmarks,
} from "./init-catalog.js";
import { clackPrompts, InitCancelled, type InitPrompts } from "./init-prompts.js";
import { checkParsedRegistry } from "./load-registry.js";
import { resolveConfigDirectory, resolveRegistryPath } from "./path.js";
import { starterRegistry } from "./starter.js";
import type { JsonValue } from "./types.js";
import { AJV_OPTIONS } from "./validate.js";

/** The file the wizard writes the Artificial Analysis key to. */
export const KEY_FILE_NAME = "artificial-analysis.env";

/** The file the wizard writes beside the target registry. */
export const INTAKE_FILE_NAME = "intake.json";

/** The message a cancelled wizard prints. */
export const CANCELLED_MESSAGE = "cancelled, nothing written";

const HARNESS_NAME_PATTERN = /^[a-z0-9-]+$/;

const intakeValidator = new Ajv2020(AJV_OPTIONS).compile(intakeSchema);

export interface InitIntake {
  readonly format: 1;
  readonly createdAt: string;
  readonly harnesses: readonly string[];
  readonly artificialAnalysisKey: "saved" | "none";
  readonly benchmarks: readonly string[];
}

export interface InitOptions {
  /** The explicit `--registry` path, when the user gave one. */
  readonly registryPath?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  /** The wizard UI; the real one by default. */
  readonly prompts?: InitPrompts | undefined;
  /** Whether stdin and stdout are a terminal; the real answer by default. */
  readonly isTty?: boolean | undefined;
  /** The time the intake records; the real clock by default. */
  readonly now?: Date | undefined;
}

export type InitOutcome =
  | { readonly kind: "starter"; readonly path: string; readonly harnesses: readonly string[] }
  | {
      readonly kind: "intake";
      readonly path: string;
      readonly intakePath: string;
      readonly benchmarks: readonly string[];
    }
  | { readonly kind: "refused"; readonly message: string; readonly fix: string }
  | { readonly kind: "cancelled" };

/** Where the Artificial Analysis key file lives: the configuration directory, never beside the registry. */
export function keyFilePath(env: Record<string, string | undefined> = process.env): string {
  return join(resolveConfigDirectory(env), KEY_FILE_NAME);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function harnessNameProblem(value: string): string | undefined {
  const name = value.trim();
  if (name === "") {
    return "Give the harness a name.";
  }
  if (!HARNESS_NAME_PATTERN.test(name)) {
    return "Use lowercase letters, digits and hyphens only.";
  }
  return undefined;
}

/** The rule a harness name the user types has to follow. */
export function validateHarnessName(value: string): string | undefined {
  return harnessNameProblem(value);
}

function writeFileAtomic(path: string, contents: string, mode: number): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${basename(path)}.init-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, contents, { flag: "wx", mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function writeKeyFile(path: string, value: string): void {
  const directory = dirname(path);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  writeFileAtomic(path, `ARTIFICIAL_ANALYSIS_API_KEY=${value}\n`, 0o600);
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, 0o644);
}

/** Check an intake against the shipped schema, so a malformed one is never written. */
export function validateIntake(value: unknown): void {
  if (!intakeValidator(value)) {
    throw new Error(
      `the intake does not match intake.schema.json: ${JSON.stringify(intakeValidator.errors)}`,
    );
  }
}

async function askHarnesses(prompts: InitPrompts): Promise<string[]> {
  return prompts.group("Harnesses", async () => {
    const chosen = await prompts.multiselect<string>({
      message: "Which harnesses do you use?",
      options: [
        ...HARNESS_CATALOG.map((entry) => ({ value: entry.id, label: entry.label })),
        {
          value: OTHER_HARNESS_ID,
          label: "Other",
          hint: "Name a harness this list does not have.",
        },
      ],
      initialValues: [],
      required: true,
    });
    const names = chosen.filter((value) => value !== OTHER_HARNESS_ID);
    if (chosen.includes(OTHER_HARNESS_ID)) {
      const other = await prompts.text({
        message: "What is the harness called?",
        placeholder: "lowercase letters, digits and hyphens",
        validate: harnessNameProblem,
      });
      names.push(other.trim());
    }
    return unique(names);
  });
}

interface KeyChoice {
  /** Whether a key is available for the benchmark reads. */
  readonly saved: boolean;
  /** The new key value, when the user gave one to save. */
  readonly value?: string;
}

async function askKey(prompts: InitPrompts, keyFile: string): Promise<KeyChoice> {
  const hasKey = await prompts.confirm({
    message: "Do you have an Artificial Analysis API key?",
    initialValue: false,
  });
  if (!hasKey) {
    return { saved: false };
  }
  const existing = existsSync(keyFile);
  if (existing) {
    const choice = await prompts.select({
      message: `An Artificial Analysis key is already saved at ${keyFile}.`,
      options: [
        { value: "keep", label: "Keep it" },
        { value: "replace", label: "Replace it" },
      ],
      initialValue: "keep",
    });
    if (choice === "keep") {
      return { saved: true };
    }
  }
  const value = await prompts.password({
    message: existing
      ? "New Artificial Analysis API key (leave empty to keep the saved one)"
      : "Artificial Analysis API key (leave empty to skip)",
  });
  const trimmed = value.trim();
  if (trimmed === "") {
    // An empty answer changes nothing: a saved key stays saved.
    return { saved: existing };
  }
  return { saved: true, value: trimmed };
}

async function askBenchmarks(prompts: InitPrompts, hasKey: boolean): Promise<string[]> {
  return prompts.group("Benchmarks", async () => {
    const chosen = await prompts.multiselect<string>({
      message: "Which benchmarks should the ratings come from?",
      options: offeredBenchmarks(hasKey).map((entry) => ({
        value: entry.id,
        label: entry.label,
        hint: entry.hint,
      })),
      initialValues: recommendedBenchmarks(hasKey),
      required: false,
    });
    return chosen;
  });
}

async function runWizard(
  target: string,
  prompts: InitPrompts,
  options: InitOptions,
): Promise<InitOutcome> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  prompts.intro("model-registry init");

  const harnesses = await askHarnesses(prompts);
  if (harnesses.length === 0) {
    return {
      kind: "refused",
      message: "no harness was chosen, so there is nothing to set up.",
      fix: "Run model-registry init again and choose at least one harness.",
    };
  }

  const keyFile = keyFilePath(env);
  const key = await askKey(prompts, keyFile);

  const benchmarks = await askBenchmarks(prompts, key.saved);

  if (benchmarks.length === 0) {
    const registry = starterRegistry(harnesses);
    const spinner = prompts.spinner();
    spinner.start("Validating the starter registry");
    const checked = checkParsedRegistry(target, registry as unknown as JsonValue, "init");
    if (!checked.ok) {
      spinner.stop("The starter registry did not validate");
      throw new Error(
        `the starter registry did not validate: ${JSON.stringify(checked.error.problems)}`,
      );
    }
    spinner.stop("The starter registry validates");
    if (key.value !== undefined) {
      writeKeyFile(keyFile, key.value);
    }
    writeJsonFile(target, registry);
    prompts.outro(
      [
        `Registry written to ${target}.`,
        "",
        "What to edit:",
        "- Replace `example-model` with the models you use, one route per harness.",
        "- Set each model's `ratings` from the benchmarks you trust.",
        "- Adjust `router.rank` and the `implement` task's floors to your work.",
        "",
        "Then run `model-registry check` and `model-router check`.",
      ].join("\n"),
    );
    return { kind: "starter", path: target, harnesses };
  }

  const intakePath = join(dirname(target), INTAKE_FILE_NAME);
  if (existsSync(intakePath)) {
    const replace = await prompts.confirm({
      message: `An intake from an earlier run is at ${intakePath}. Replace it?`,
      initialValue: false,
    });
    if (!replace) {
      throw new InitCancelled();
    }
  }

  const intake: InitIntake = {
    format: 1,
    createdAt: now.toISOString(),
    harnesses,
    artificialAnalysisKey: key.saved ? "saved" : "none",
    benchmarks,
  };
  validateIntake(intake);
  if (key.value !== undefined) {
    writeKeyFile(keyFile, key.value);
  }
  writeJsonFile(intakePath, intake);
  prompts.outro(
    [
      `Intake written to ${intakePath}.`,
      "",
      "Next: ask your agent to use the model-registry skill.",
      "It reads the intake, rates the models, and writes the registry.",
    ].join("\n"),
  );
  return { kind: "intake", path: target, intakePath, benchmarks };
}

/**
 * Run the init wizard. The wizard writes a starter registry when no
 * benchmark was chosen, and an intake file when some were; it refuses when
 * the target exists or when there is no terminal, and it writes nothing at
 * all when the user cancels.
 */
export async function runInit(options: InitOptions = {}): Promise<InitOutcome> {
  const env = options.env ?? process.env;
  const prompts = options.prompts ?? clackPrompts();
  const target = resolveRegistryPath(options.registryPath, env);

  if (existsSync(target)) {
    return {
      kind: "refused",
      message: `a registry file already exists at "${target}"`,
      fix: "Use the model-registry skill to extend the registry that is already there.",
    };
  }

  const isTty = options.isTty ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  if (!isTty) {
    return {
      kind: "refused",
      message: "the init wizard is interactive: stdin and stdout must both be a terminal.",
      fix: "Run model-registry init from a terminal, or ask the model-registry skill to build the registry.",
    };
  }

  try {
    return await runWizard(target, prompts, options);
  } catch (error) {
    if (error instanceof InitCancelled) {
      prompts.cancel(CANCELLED_MESSAGE);
      return { kind: "cancelled" };
    }
    throw error;
  }
}
