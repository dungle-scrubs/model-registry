import { homedir } from "node:os";
import { resolve } from "node:path";

const REGISTRY_FILENAME = "registry.json";
const CONFIG_DIRECTORY = "model-registry";

type PathEnvironment = { [key: string]: string | undefined };

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
  const configHome = env.XDG_CONFIG_HOME;
  const base =
    configHome !== undefined && configHome !== "" ? resolve(configHome) : resolve(home, ".config");
  return resolve(base, CONFIG_DIRECTORY, REGISTRY_FILENAME);
}
