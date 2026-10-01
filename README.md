# model-registry

The shared model registry: one versioned source of truth that ranks model routes (a model reached through one harness) for a structured query.

Consumers state what the work needs as ratings and capabilities. The registry is the only place that qualifies models. Current consumers are the `choose-model` and `delegate` skills and graybox.

This package loads and validates the registry file. Design: [`docs/rfc/01_shared-model-registry-and-router.rfc.md`](docs/rfc/01_shared-model-registry-and-router.rfc.md). Development release: the package is private and unpublished.

## CLI

```console
$ model-registry check --registry examples/registry.json
{"format":1,"digest":"sha256:<64 hex characters>","path":"/absolute/path/to/registry.json"}
```

`check` loads a registry file, validates it, and prints `format`, `digest` and `path` as one JSON line. The digest is the SHA-256 of the file bytes exactly as read, reproducible with any standard checksum tool.

Exit codes:

| Exit | Meaning |
|---|---|
| 0 | the check succeeded |
| 2 | invalid usage (`usage-invalid` on stderr) |
| 4 | the loader failed; one `{"error": ...}` envelope on stderr lists every problem |
| 1 | an internal fault (`internal-error` on stderr) |

Errors print as one JSON line on stderr: `{"error":{"code":"...","message":"...","fix":"...","path":"...","problems":[]}}`.

## Path resolution

`check` and the library resolve the registry file in this order:

1. An explicit path: `--registry <path>` or the `path` option.
2. `MODEL_REGISTRY_FILE`.
3. `$XDG_CONFIG_HOME/model-registry/registry.json`.
4. When `XDG_CONFIG_HOME` is unset: `~/.config/model-registry/registry.json`, on every platform including macOS.

Relative paths resolve against the current working directory. The returned path is absolute and normalized; symlinks are not resolved, and a literal `~` is never expanded. A missing file fails with `registry-missing`; the example is never loaded in its place.

## Library

```ts
import { buildRouteLabel, loadRegistry, RegistryError } from "@dungle-scrubs/model-registry";

const loaded = loadRegistry({ path: "registry.json" });
loaded.format; // 1
loaded.digest; // "sha256:<hex>"
loaded.path; // the resolved path
loaded.registry.models; // the models with their written route order
loaded.registry.ratings; // declared ratings, when the file has them
loaded.registry.capabilities; // declared capabilities, when the file has them
loaded.registry.meters; // declared meters, when the file has them
loaded.routes["model-a@harness-x"]; // { model: "model-a", ...route facts }
loaded.sections.router; // foreign sections, untouched

buildRouteLabel("model-a", { harness: "harness-y", provider: "provider-1" }); // "model-a@harness-y/provider-1"
```

`loadRegistry` is synchronous, reads the file once, and never changes it. On failure it throws one `RegistryError` carrying `code`, `message`, `fix`, `path` and `problems`, where each problem has `code`, `field` (a JSONPath such as `$["models"]["model-a"]["routes"][0]["hosted"]`), `message` and `fix`.

## Supported slice of format 1

Accepted and validated in this release: top-level `format`, `ratings`, `capabilities`, `meters`, `models`; model `family`, `notes`, `routes`, `ratings`, `maxEffort`, `fixedEffort`; route `harness`, `modelId`, `provider`, `hosted`, `privacyEligible`, `cost`, `rateLimitRpm`, `responseSeconds`, `notes`, `capabilities`, `meter`. `cost` and a model `ratings` entry are an integer 1 to 10 (higher is cheaper for `cost`). `rateLimitRpm` and `responseSeconds` are finite numbers of 0 or more. `null` is invalid anywhere, including inside foreign sections. Any other top-level section passes through untouched.

A model `ratings` name, a route `capabilities` entry and a route `meter` name must be declared in the matching top-level section; an undeclared reference fails with `reference-unknown` and the field is the JSONPath of the reference. An absent section declares nothing, so every reference then fails.

Not supported yet: the owned section `calibration`. A file carrying `calibration` fails with `registry-invalid` and a fix that names the later slice.

## Loader result

`loadRegistry` returns one `LoadedRegistry`:

```ts
{
  path: string,          // the resolved path
  digest: "sha256:<hex>", // of the file bytes as read
  format: 1,
  registry: {
    ratings?: Readonly<Record<string, string>>,    // when the file declares them
    capabilities?: Readonly<Record<string, string>>, // when the file declares them
    meters?: Readonly<Record<string, Meter>>,        // when the file declares them
    models: Readonly<Record<string, Model>>,         // always present
  },
  routes: Readonly<Record<RouteLabel, IndexedRoute>>, // by label
  sections: Readonly<Record<string, JsonValue>>,      // foreign sections only
}
```

`ratings`, `capabilities` and `meters` are typed sections of the format and live under `registry`; foreign sections such as `router`, `tasks` and `policy` live under `sections`. The owned `calibration` section is not yet supported and is rejected with `registry-invalid`.

The runtime shape is published as `registry.schema.json` (JSON Schema 2020-12), and `examples/registry.json` holds a complete placeholder example.

## Effort ladder

The ladder is fixed in the format: `low < medium < high < xhigh < max`. `EFFORT_LADDER` is the readonly tuple and `EffortLevel` its element type; the JSON schema enum mirrors the tuple, and `acceptance` asserts the order on every run. A new level is a minor release.

```ts
import { EFFORT_LADDER } from "@dungle-scrubs/model-registry";
import type { EffortLevel } from "@dungle-scrubs/model-registry";

EFFORT_LADDER; // readonly ["low", "medium", "high", "xhigh", "max"]
const effort: EffortLevel = "high";
```

## Error codes

| Code | Cause |
|---|---|
| `registry-missing` | no file at the resolved path |
| `registry-unreadable` | the file cannot be read or parsed |
| `format-missing` | no `format` field: not a version 1 registry |
| `format-unsupported` | a newer or older format major |
| `registry-invalid` | a shape error, an unknown field, or `null` |
| `label-duplicate` | two routes with the same label |
| `reference-unknown` | a model rating, route capability or route meter that is not declared in its matching top-level section |

`rating-mismatch` belongs to a later ticket and is not emitted yet.

## Development

```console
$ pnpm install
$ pnpm verify     # lint, typecheck, build, tests
$ pnpm test:mutation
```

Planned work after RFC-01 is in [docs/roadmap.md](docs/roadmap.md).
