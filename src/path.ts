import { homedir } from "node:os";
import { resolve } from "node:path";

const REGISTRY_FILENAME = "registry.json";
const CONFIG_DIRECTORY = "model-registry";

type PathEnvironment = { [key: string]: string | undefined };

/**
 * The directory the package keeps its configuration in:
 * `$XDG_CONFIG_HOME/model-registry`, or `~/.config/model-registry` when that
 * variable is unset or empty. It never depends on a registry path.
 */
export function resolveConfigDirectory(
  env: PathEnvironment = process.env,
  home: string = homedir(),
): string {
  const configHome = env.XDG_CONFIG_HOME;
  const base =
    configHome !== undefined && configHome !== "" ? resolve(configHome) : resolve(home, ".config");
  return resolve(base, CONFIG_DIRECTORY);
}

export function resolveRegistryPath(
  explicitPath: string | undefined,
  env: PathEnvironment = process.env,
  home: string = homedir(),
): string {
  if (explicitPath !== undefined) {
    return resolve(explicitPath);
  }
  const environmentPath = env.MODEL_REGISTRY_FILE;
  if (environmentPath !== undefined && environmentPath !== "") {
    return resolve(environmentPath);
  }
  return resolve(resolveConfigDirectory(env, home), REGISTRY_FILENAME);
}
