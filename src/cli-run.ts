import { createHash } from "node:crypto";
import { Command, CommanderError, Option } from "commander";
import { RegistryError } from "./error.js";
import { loadRegistry } from "./load-registry.js";
import { runMigrate } from "./migrate.js";
import type { RegistryErrorDetails } from "./types.js";

const VERSION = process.env.MODEL_REGISTRY_VERSION ?? "0.0.0-dev";

const EXIT_SUCCESS = 0;
const EXIT_INTERNAL_FAULT = 1;
/** Exit code 2 covers both `usage-invalid` and `backup-exists`. */
const EXIT_USAGE_OR_REFUSED = 2;
const EXIT_LOADER_FAILURE = 4;

const USAGE_FIX = "Run model-registry --help for the available commands and options.";
const NO_COMMAND_FIX =
  "Run model-registry check, or model-registry --help for the available commands.";
const INTERNAL_FIX = "Report this failure together with the command you ran.";

class UsageError extends Error {
  readonly fix: string;

  constructor(message: string, fix: string) {
    super(message);
    this.name = "UsageError";
    this.fix = fix;
  }
}

export interface CliSink {
  write(chunk: string | Uint8Array): boolean;
}

export interface CliIo {
  stdout: CliSink;
  stderr: CliSink;
}

type CliErrorEnvelope =
  | RegistryErrorDetails
  | { code: "usage-invalid"; fix: string; message: string }
  | { code: "internal-error"; fix: string; message: string };

function writeErrorEnvelope(io: CliIo, envelope: CliErrorEnvelope): void {
  io.stderr.write(`${JSON.stringify({ error: envelope })}\n`);
}

interface RegistryOptionState {
  values: string[];
}

function addRegistryOption(command: Command): RegistryOptionState {
  const state: RegistryOptionState = { values: [] };
  command.addOption(
    new Option("--registry <path>", "path to the registry file").argParser((value: string) => {
      state.values.push(value);
      return value;
    }),
  );
  return state;
}

function consumeRegistryPath(state: RegistryOptionState, commandName: string): string | undefined {
  if (state.values.length > 1) {
    throw new UsageError(
      "the --registry option was given more than once.",
      `Give model-registry ${commandName} exactly one --registry path.`,
    );
  }
  const explicit = state.values[0];
  if (explicit === "") {
    throw new UsageError(
      "the --registry option was given an empty path.",
      "Give --registry a non-empty path to a registry file.",
    );
  }
  return explicit;
}

function buildProgram(io: CliIo): Command {
  const program = new Command();
  program
    .name("model-registry")
    .description("Load and validate a versioned model registry.")
    .version(VERSION)
    .exitOverride();
  program.configureOutput({
    writeOut: (text) => {
      io.stdout.write(text);
    },
    writeErr: () => {},
  });

  const check = program
    .command("check")
    .description("Load a registry file and print its format, digest and path.")
    .allowExcessArguments(false)
    .exitOverride();
  check.configureOutput({
    writeOut: (text) => {
      io.stdout.write(text);
    },
    writeErr: () => {},
  });
  const checkRegistry = addRegistryOption(check);
  check.action(() => {
    const explicit = consumeRegistryPath(checkRegistry, "check");
    const result = loadRegistry(explicit === undefined ? {} : { path: explicit });
    io.stdout.write(
      `${JSON.stringify({ format: result.format, digest: result.digest, path: result.path })}\n`,
    );
  });

  const migrate = program
    .command("migrate")
    .description("Migrate a registry file to the current format, with a backup written beside it.")
    .allowExcessArguments(false)
    .exitOverride();
  migrate.configureOutput({
    writeOut: (text) => {
      io.stdout.write(text);
    },
    writeErr: () => {},
  });
  const migrateRegistry = addRegistryOption(migrate);
  let dryRun = false;
  migrate.option("--dry-run", "print the migrated file on stdout and write nothing", () => {
    dryRun = true;
    return true;
  });
  migrate.action(() => {
    const explicit = consumeRegistryPath(migrateRegistry, "migrate");
    const outcome = runMigrate({ ...(explicit === undefined ? {} : { path: explicit }), dryRun });
    if (outcome.kind === "error") {
      throw outcome.error;
    }
    if (outcome.kind === "nothing-to-do") {
      io.stdout.write("nothing to do\n");
      return;
    }
    if (outcome.kind === "dry-run") {
      io.stdout.write(outcome.bytes);
      return;
    }
    const newDigest = `sha256:${createHash("sha256").update(outcome.bytes).digest("hex")}`;
    io.stdout.write(
      `${JSON.stringify({
        format: outcome.format,
        digest: newDigest,
        path: outcome.path,
        backup: outcome.backupPath,
      })}\n`,
    );
  });

  return program;
}

function commanderMessage(error: CommanderError): string {
  return error.message.replace(/^error:\s*/, "");
}

export function runCli(argv: string[], io: CliIo): number {
  try {
    buildProgram(io).parse(argv, { from: "user" });
    return EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof UsageError) {
      writeErrorEnvelope(io, { code: "usage-invalid", fix: error.fix, message: error.message });
      return EXIT_USAGE_OR_REFUSED;
    }
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version" ||
        error.code === "commander.versionDisplayed"
      ) {
        return EXIT_SUCCESS;
      }
      if (error.code === "commander.help") {
        writeErrorEnvelope(io, {
          code: "usage-invalid",
          fix: NO_COMMAND_FIX,
          message: "no command was given.",
        });
        return EXIT_USAGE_OR_REFUSED;
      }
      writeErrorEnvelope(io, {
        code: "usage-invalid",
        fix: USAGE_FIX,
        message: commanderMessage(error),
      });
      return EXIT_USAGE_OR_REFUSED;
    }
    if (error instanceof RegistryError) {
      if (error.code === "backup-exists") {
        writeErrorEnvelope(io, error.toJSON());
        return EXIT_USAGE_OR_REFUSED;
      }
      writeErrorEnvelope(io, error.toJSON());
      return EXIT_LOADER_FAILURE;
    }
    writeErrorEnvelope(io, {
      code: "internal-error",
      fix: INTERNAL_FIX,
      message: error instanceof Error ? error.message : String(error),
    });
    return EXIT_INTERNAL_FAULT;
  }
}
