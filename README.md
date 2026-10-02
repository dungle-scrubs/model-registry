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

```console
$ model-registry migrate --registry examples/registry.json
nothing to do
```

`migrate` brings a registry file forward to the current format. On a file that is already current it prints `nothing to do` and exits 0, with or without `--dry-run`. To upgrade, it reads the file, applies each migration step in turn, validates the result with the same checks as `check`, then writes the backup `<registry>.format-<original-format>.bak` beside the file and replaces the file. `--dry-run` prints the migrated file on stdout (2-space indented JSON followed by a newline) and writes nothing. The replacement and the backup keep the file's mode; a symlinked registry is migrated through the link, which stays in place, and the backup is written beside its target. If the backup write itself fails partway, the partial backup is removed so the next run is not refused; the command then fails with `internal-error`. If the replacement fails, the temporary file is removed and the backup stays in place, so the original file is never lost; the command then fails with `internal-error`, and the next run refuses with `backup-exists` until the backup is moved aside. Each migration step is added in the release that introduces the format it leads to; format 1 is the first major, so no step ships yet.

Exit codes:

| Exit | Meaning |
|---|---|
| 0 | the command succeeded; for `migrate`, `nothing to do` or a one-line `{"format","digest","path","backup"}` JSON record on success |
| 2 | invalid usage (`usage-invalid` on stderr), or a `migrate` refusal because the backup already exists (`backup-exists` on stderr) |
| 4 | the loader or the migrated result failed; one `{"error": ...}` envelope on stderr lists every problem |
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
loaded.registry.calibration; // the calibration section, when the file has one
loaded.routes["model-a@harness-x"]; // { model: "model-a", ...route facts }
loaded.sections.router; // foreign sections, untouched

buildRouteLabel("model-a", { harness: "harness-y", provider: "provider-1" }); // "model-a@harness-y/provider-1"
```

`loadRegistry` is synchronous, reads the file once, and never changes it. On failure it throws one `RegistryError` carrying `code`, `message`, `fix`, `path` and `problems`, where each problem has `code`, `field` (a JSONPath such as `$["models"]["model-a"]["routes"][0]["hosted"]`), `message` and `fix`.

## Supported slice of format 1

Accepted and validated in this release: top-level `format`, `ratings`, `capabilities`, `meters`, `models`, `calibration`; model `family`, `notes`, `routes`, `ratings`, `maxEffort`, `fixedEffort`; route `harness`, `modelId`, `provider`, `hosted`, `privacyEligible`, `cost`, `rateLimitRpm`, `responseSeconds`, `notes`, `capabilities`, `meter`; calibration `notes`, `benchmarks`, `feeds`, `handSet`, `figures`, `overrides`. A model rating and the `value` of an override are integers 1 to 10; the `cost` of a route is the same range, with higher meaning cheaper. `rateLimitRpm` and `responseSeconds` are finite numbers of 0 or more. `null` is invalid anywhere, including inside foreign sections. Any other top-level section passes through untouched.

A model `ratings` name, a route `capabilities` entry and a route `meter` name must be declared in the matching top-level section; an undeclared reference fails with `reference-unknown` and the field is the JSONPath of the reference. An absent section declares nothing, so every reference then fails.

`calibration` records how the ratings were produced. `cost` is the reserved route-level rating: in `feeds`, `handSet` and `overrides` it targets `route.cost` by route label and needs no `ratings` entry; every other rating named in those places must be declared in `ratings`. Every benchmark name in `calibration.feeds` must exist in `calibration.benchmarks`. A rating must not appear in both `handSet` and `feeds`. Figures may name a model or route the file does not declare; they are shape-checked and skipped by the rating check. Only ratings named in `feeds` are checked: every written value of such a rating must equal the value its table computes, carry a matching `calibration.overrides` entry (`rating`, exactly one of `model` or `route`, `value` 1-10, a non-empty `reason`), or be named in `handSet`; a written route `cost` is checked the same way, only when `cost` is in `feeds`. A rating no feed names, and a `calibration` with no `feeds`, checks nothing. Otherwise the load fails with `rating-mismatch`, one problem per written value, and the `fix` names the computed value and the override that would allow the written one.

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
    calibration?: Calibration,                       // when the file declares one
    models: Readonly<Record<string, Model>>,         // always present
  },
  routes: Readonly<Record<RouteLabel, IndexedRoute>>, // by label
  sections: Readonly<Record<string, JsonValue>>,      // foreign sections only
}
```

`ratings`, `capabilities`, `meters` and `calibration` are typed sections of the format and live under `registry`; foreign sections such as `router`, `tasks` and `policy` live under `sections`. The runtime shape is published as `registry.schema.json` (JSON Schema 2020-12), and `examples/registry.json` holds a complete placeholder example.

## Effort ladder

The ladder is fixed in the format: `low < medium < high < xhigh < max`. `EFFORT_LADDER` is the readonly tuple and `EffortLevel` its element type; the JSON schema enum mirrors the tuple, and `acceptance` asserts the order on every run. A new level is a minor release.

```ts
import { EFFORT_LADDER } from "@dungle-scrubs/model-registry";
import type { EffortLevel } from "@dungle-scrubs/model-registry";

EFFORT_LADDER; // readonly ["low", "medium", "high", "xhigh", "max"]
const effort: EffortLevel = "high";
```

## Rating method

The package ships no code that produces ratings and no default bands. It ships one agent prompt at `prompts/rating.md` (also published as `@dungle-scrubs/model-registry/prompts/rating.md`). The prompt follows the RFC's five steps: ask which ratings, benchmarks and models matter; propose bands and wait for approval; read and record figures with `value`, `read` and `effort`; write ratings, overrides and handSet entries; run `model-registry check`. Artificial Analysis is the named example source for the upstream figures.

## Error codes

| Code | Cause |
|---|---|
| `registry-missing` | no file at the resolved path |
| `registry-unreadable` | the file cannot be read or parsed |
| `format-missing` | no `format` field: not a version 1 registry |
| `format-unsupported` | a newer or older format major; the fix names upgrading model-registry for a newer format, and names `migrate` for an older format only when this release ships a step from it, otherwise it says to recreate the file as format 1 |
| `registry-invalid` | a shape error, an unknown field, or `null` |
| `label-duplicate` | two routes with the same label |
| `reference-unknown` | an undeclared rating, capability, meter, benchmark, model or route label in the format's own sections: a model rating name, a route capability or meter, a calibration `feeds` or `handSet` rating name, a `feeds` benchmark name, or an `overrides` rating, model or route |
| `rating-mismatch` | a written rating that the stored table does not give and no override allows; the `fix` names the computed value (or that the table gives none) and the override that would allow the written value |
| `backup-exists` | `migrate` refused because a backup already sits beside the registry |

## Development

```console
$ pnpm install
$ pnpm verify     # lint, typecheck, build, tests
$ pnpm test:mutation
```

Planned work after RFC-01 is in [docs/roadmap.md](docs/roadmap.md).
