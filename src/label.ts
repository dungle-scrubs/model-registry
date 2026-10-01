import type { Route } from "./types.js";

/**
 * Build the public route label: `<model key>@<harness>` with a `/<provider>`
 * suffix when the provider is present. The model key is used, never the
 * `modelId`. Components are not escaped, normalized, trimmed or parsed.
 * The provider suffix follows presence, not truthiness: an empty provider
 * still produces the suffix.
 */
export function buildRouteLabel(
  modelKey: string,
  route: Pick<Route, "harness" | "provider">,
): string {
  if (route.provider === undefined) {
    return `${modelKey}@${route.harness}`;
  }
  return `${modelKey}@${route.harness}/${route.provider}`;
}
