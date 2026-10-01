import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RegistryError } from "../src/error.js";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const cliPath = join(repoRoot, "dist", "cli.js");
export const builtIndexPath = join(repoRoot, "dist", "index.js");
export const examplePath = join(repoRoot, "examples", "registry.json");
export const schemaPath = join(repoRoot, "registry.schema.json");

export function catchRegistryError(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RegistryError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected loadRegistry to throw");
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function requireBuild(): void {
  if (!existsSync(cliPath)) {
    throw new Error("dist/cli.js is missing; run pnpm build before the tests.");
  }
}

export function runBuiltCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): CliResult {
  requireBuild();
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    env: merged,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? -1,
  };
}

export async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "model-registry-test-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeJson(dir: string, name: string, data: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

export async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    saved.set(key, process.env[key]);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export function createXdgConfigHome(dir: string, data: unknown): string {
  const configHome = join(dir, "xdg-config");
  mkdirSync(join(configHome, "model-registry"), { recursive: true });
  writeFileSync(join(configHome, "model-registry", "registry.json"), JSON.stringify(data));
  return configHome;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function supportedProperties(properties: Record<string, unknown>): string[] {
  return Object.entries(properties)
    .filter(([, definition]) => definition !== false)
    .map(([name]) => name)
    .sort();
}

export function deferredProperties(properties: Record<string, unknown>): string[] {
  return Object.entries(properties)
    .filter(([, definition]) => definition === false)
    .map(([name]) => name)
    .sort();
}

export function captureStream(): {
  stream: { write(chunk: string | Uint8Array): boolean };
  text: () => string;
} {
  let buffer = "";
  return {
    stream: {
      write(chunk: string | Uint8Array) {
        buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        return true;
      },
    },
    text: () => buffer,
  };
}
