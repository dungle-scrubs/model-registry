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
$ model-registry migrate --registry examples/registry.json --dry-run
<the migrated registry as 2-space indented JSON followed by a newline>
```

`migrate` brings a registry file forward to the current format. On a file that is already current it prints `nothing to do` and exits 0. To upgrade, it reads the file, applies each migration step in turn, validates the result with the same checks as `check`, then writes the backup `<registry>.format-<original-format>.bak` beside the file and replaces the file. `--dry-run` prints the migrated file on stdout and writes nothing. Each migration step is added in the release that introduces the format it leads to; format 1 is the first major, so no step ships yet.

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
loaded.routes["model-a@harness-x"]; // { model: "model-a", ...route facts }
loaded.sections.router; // foreign sections, untouched

buildRouteLabel("model-a", { harness: "harness-y", provider: "provider-1" }); // "model-a@harness-y/provider-1"
```

`loadRegistry` is synchronous, reads the file once, and never changes it. On failure it throws one `RegistryError` carrying `code`, `message`, `fix`, `path` and `problems`, where each problem has `code`, `field` (a JSONPath such as `$["models"]["model-a"]["routes"][0]["hosted"]`), `message` and `fix`.

## Supported slice of format 1

Accepted and validated in this release: `format`, `models`; model `family`, `notes`, `routes`; route `harness`, `modelId`, `provider`, `hosted`, `privacyEligible`, `cost`, `rateLimitRpm`, `responseSeconds`, `notes`. `cost` is an integer 1 to 10 (higher is cheaper); `rateLimitRpm` and `responseSeconds` are finite numbers of 0 or more. `null` is invalid anywhere, including inside foreign sections. Any other top-level section passes through untouched.

Not supported yet: the owned sections `ratings`, `capabilities`, `meters` and `calibration`; model `ratings`, `maxEffort`, `fixedEffort`; route `capabilities` and `meter`. A file carrying one of these fields fails with `registry-invalid` and a fix that names the later slice. Declaration validation arrives in the next tickets.

The runtime shape is published as `registry.schema.json` (JSON Schema 2020-12), and `examples/registry.json` holds a complete placeholder example.

## Error codes

| Code | Cause |
|---|---|
| `registry-missing` | no file at the resolved path |
| `registry-unreadable` | the file cannot be read or parsed |
| `format-missing` | no `format` field: not a version 1 registry |
| `format-unsupported` | a newer or older format major; for older formats the fix names `model-registry migrate`, for newer formats it names upgrading model-registry |
| `registry-invalid` | a shape error, an unknown field, or `null` |
| `label-duplicate` | two routes with the same label |
| `backup-exists` | `migrate` refused because a backup already sits beside the registry |

`reference-unknown` and `rating-mismatch` belong to later tickets and are not emitted yet.

## Development

```console
$ pnpm install
$ pnpm verify     # lint, typecheck, build, tests
$ pnpm test:mutation
```

Planned work after RFC-01 is in [docs/roadmap.md](docs/roadmap.md).
