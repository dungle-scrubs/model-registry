import { Command, CommanderError } from "commander";
import { RegistryError } from "./error.js";
import { loadRegistry } from "./load-registry.js";
import type { RegistryErrorDetails } from "./types.js";

const VERSION = process.env.MODEL_REGISTRY_VERSION ?? "0.0.0-dev";

const EXIT_SUCCESS = 0;
const EXIT_INTERNAL_FAULT = 1;
const EXIT_USAGE_INVALID = 2;
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

  const registryValues: string[] = [];
  check.option("--registry <path>", "path to the registry file", (value: string) => {
    registryValues.push(value);
  });
  check.action(() => {
    if (registryValues.length > 1) {
      throw new UsageError(
        "the --registry option was given more than once.",
        "Give model-registry check exactly one --registry path.",
      );
    }
    const explicit = registryValues[0];
    if (explicit === "") {
      throw new UsageError(
        "the --registry option was given an empty path.",
        "Give --registry a non-empty path to a registry file.",
      );
    }
    const result = loadRegistry(explicit === undefined ? {} : { path: explicit });
    io.stdout.write(
      `${JSON.stringify({ format: result.format, digest: result.digest, path: result.path })}\n`,
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
      return EXIT_USAGE_INVALID;
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
        return EXIT_USAGE_INVALID;
      }
      writeErrorEnvelope(io, {
        code: "usage-invalid",
        fix: USAGE_FIX,
        message: commanderMessage(error),
      });
      return EXIT_USAGE_INVALID;
    }
    if (error instanceof RegistryError) {
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
