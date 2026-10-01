import { homedir } from "node:os";
import { resolve } from "node:path";

const REGISTRY_FILENAME = "registry.json";
const CONFIG_DIRECTORY = "model-registry";

type PathEnvironment = { [key: string]: string | undefined };

/**
 * Resolve the registry path with the one path rule, shared by the library
 * and the CLI: an explicit path, then MODEL_REGISTRY_FILE, then
 * $XDG_CONFIG_HOME/model-registry/registry.json, then
 * ~/.config/model-registry/registry.json on every platform, macOS included.
 *
 * Relative paths resolve against the current working directory. The result
 * is absolute and normalized, but symlinks are not resolved, and a literal
 * `~` is never expanded. Empty environment values count as unset. An empty
 * explicit path stays empty so the failure can name it.
 */
export function resolveRegistryPath(
  explicitPath: string | undefined,
  env: PathEnvironment = process.env,
  home: string = homedir(),
): string {
  if (explicitPath !== undefined) {
    return explicitPath === "" ? "" : resolve(explicitPath);
  }
  const environmentPath = env.MODEL_REGISTRY_FILE;
  if (environmentPath !== undefined && environmentPath !== "") {
    return resolve(environmentPath);
  }
  const configHome = env.XDG_CONFIG_HOME;
  const base =
    configHome !== undefined && configHome !== "" ? resolve(configHome) : resolve(home, ".config");
  return resolve(base, CONFIG_DIRECTORY, REGISTRY_FILENAME);
}
