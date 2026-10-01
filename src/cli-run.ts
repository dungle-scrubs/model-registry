import { Command, CommanderError } from "commander";
import { RegistryError } from "./error.js";
import { loadRegistry } from "./load-registry.js";

const VERSION = process.env.MODEL_REGISTRY_VERSION ?? "0.0.0-dev";

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

interface ErrorEnvelope {
  code: string;
  message: string;
  fix: string;
  path?: string;
  problems?: unknown[];
}

function writeErrorEnvelope(io: CliIo, envelope: ErrorEnvelope): void {
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

/**
 * Run the CLI. Returns the process exit code and writes every channel
 * through the given streams: 0 success, 2 usage-invalid, 4 loader failure,
 * 1 internal fault. Help and version output exit 0.
 */
export function runCli(argv: string[], io: CliIo): number {
  try {
    buildProgram(io).parse(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      writeErrorEnvelope(io, { code: "usage-invalid", message: error.message, fix: error.fix });
      return 2;
    }
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version" ||
        error.code === "commander.versionDisplayed"
      ) {
        return 0;
      }
      if (error.code === "commander.help") {
        writeErrorEnvelope(io, {
          code: "usage-invalid",
          message: "no command was given.",
          fix: NO_COMMAND_FIX,
        });
        return 2;
      }
      writeErrorEnvelope(io, {
        code: "usage-invalid",
        message: commanderMessage(error),
        fix: USAGE_FIX,
      });
      return 2;
    }
    if (error instanceof RegistryError) {
      writeErrorEnvelope(io, {
        code: error.code,
        message: error.message,
        fix: error.fix,
        path: error.path,
        problems: error.problems,
      });
      return 4;
    }
    writeErrorEnvelope(io, {
      code: "internal-error",
      message: error instanceof Error ? error.message : String(error),
      fix: INTERNAL_FIX,
    });
    return 1;
  }
}
