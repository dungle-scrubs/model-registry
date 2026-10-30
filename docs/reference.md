# model-registry reference

The full contract for model-registry 0.4.x: the CLI, path resolution, the library, every rule the loader checks in format 1, the loader result, the effort ladder, the shipped agent skill, and every error code. The [README](../README.md) covers installing and the common tasks. The design is in [RFC-01](rfc/01_shared-model-registry-and-router.rfc.md), and profiles in [RFC-02](rfc/02_registry-profiles-and-model-list-discovery.rfc.md).

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
| 130 | the `init` wizard was cancelled at a prompt; nothing was written |

Errors print as one JSON line on stderr: `{"error":{"code":"...","message":"...","fix":"...","path":"...","problems":[]}}`.

### init

`model-registry init` sets up a first registry with a terminal wizard. It
takes the same `--registry` path as `check`, so the target is the path
`check` resolves: `--registry`, then `MODEL_REGISTRY_FILE`, then the XDG
default.

The wizard asks three things: which harnesses you use, whether you have an
Artificial Analysis API key, and which benchmarks the ratings should come
from. It writes one of two files.

A starter registry at the target, when no benchmark was chosen. The starter
holds every section a registry has: two ratings, one capability, one model
with a route per chosen harness, the `router` rank, one task with its
`low`, `normal` and `high` floors and its rank, and a `default` profile
listing every route label. It passes `model-registry check` and
`model-router check` as written.

An `intake.json` beside the target, when benchmarks were chosen. The intake
holds the answers the skill needs, and the CLI writes no registry on this
path.

Exit codes for `init`:

| Exit | Meaning |
|---|---|
| 0 | the wizard finished; a starter registry or an intake file was written |
| 2 | the target already exists, or stdin and stdout are not both a terminal (`usage-invalid` on stderr) |
| 130 | the wizard was cancelled at a prompt; nothing was written |

The wizard never overwrites a registry that is already there: it exits 2,
names the path, and points at the `model-registry` skill. Cancelling at any
prompt prints `cancelled, nothing written` and exits 130.

#### The Artificial Analysis key file

The key is stored at `$XDG_CONFIG_HOME/model-registry/artificial-analysis.env`,
or `~/.config/model-registry/artificial-analysis.env` when `XDG_CONFIG_HOME`
is unset. This path never depends on `--registry`. The file holds one line:

```text
ARTIFICIAL_ANALYSIS_API_KEY=<value>
```

The file's mode is 0600, its directory's mode is 0700, and the file is
written atomically through a temporary file in the same directory. Windows has
no POSIX permission bits, so there the file is protected only by the
permissions of the folder it lives in, normally the user's profile. The value
is never printed, never logged, and never recorded in the intake or the
registry; the intake records only `"saved"` or `"none"`. An empty answer at
the key prompt changes nothing: with a key already saved, the saved key stays
and the intake records `"saved"`; with none saved, no key file is written and
the intake records `"none"`.

#### The intake file

`intake.json` sits beside the target registry and matches the shipped
`intake.schema.json`:

```json
{
  "format": 1,
  "createdAt": "2026-10-30T12:00:00.000Z",
  "harnesses": ["claude", "pi"],
  "artificialAnalysisKey": "saved",
  "benchmarks": ["aa-intelligence", "arena-webdev"]
}
```

The `benchmarks` names are the ids the wizard offers: `aa-intelligence`,
`aa-cost`, `epoch-eci`, `livebench-coding`, `terminal-bench`,
`openrouter-pricing`, `livebench-cost` and `arena-webdev`. The
`model-registry` skill reads the intake and takes the harnesses and the
approved benchmarks from it.

When an `intake.json` from an earlier run is already there, the wizard asks
before replacing it, defaulting to no. Declining ends the run like a cancel:
exit 130, and nothing is written, the key file included.

## Path resolution

`check`, `init` and the library resolve the registry file in this order:

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

Accepted and validated in this release: top-level `format`, `ratings`, `capabilities`, `meters`, `models`, `calibration`, `profiles`; model `family`, `notes`, `routes`, `ratings`, `maxEffort`, `fixedEffort`; route `harness`, `modelId`, `provider`, `hosted`, `privacyEligible`, `cost`, `rateLimitRpm`, `responseSeconds`, `notes`, `capabilities`, `meter`; calibration `notes`, `benchmarks`, `feeds`, `handSet`, `figures`, `overrides`. A model rating and the `value` of an override are integers 1 to 10; the `cost` of a route is the same range, with higher meaning cheaper. `rateLimitRpm` and `responseSeconds` are finite numbers of 0 or more. `null` is invalid anywhere, including inside foreign sections. Any other top-level section passes through untouched.

A model `ratings` name, a route `capabilities` entry and a route `meter` name must be declared in the matching top-level section; an undeclared reference fails with `reference-unknown` and the field is the JSONPath of the reference. An absent section declares nothing, so every reference then fails.

`calibration` records how the ratings were produced. `cost` is the reserved route-level rating: in `feeds`, `handSet` and `overrides` it targets `route.cost` by route label and needs no `ratings` entry; every other rating named in those places must be declared in `ratings`. An override naming `cost` must carry a `route` label, and an override for any other rating must carry a `model` key. Every benchmark name in `calibration.feeds` must exist in `calibration.benchmarks`. A rating must not appear in both `handSet` and `feeds`. Figures may name a model or route the file does not declare; they are shape-checked and skipped by the rating check. Only ratings named in `feeds` are checked: every written value of such a rating must equal the value its table computes or match a `calibration.overrides` entry for that rating and target (`rating`, exactly one of `model` or `route`, `value` equal to the written value, a non-empty `reason`); any matching override allows the written value, duplicates in any order, and an override whose value differs never fails a value the table computes. A written route `cost` is checked the same way, only when `cost` is in `feeds`. A rating in `handSet` is never compared, and a rating no feed names, or a `calibration` with no `feeds`, checks nothing. A failed check fails the load with `rating-mismatch`, one problem per written value, and the `fix` names the computed value, or that the table gives none, and the override that would allow the written one.

`profiles` is optional and maps non-empty names to closed objects with a required
`description` string (one line is the convention, not a rule), a required
`routes` array of explicit route labels and an optional `gaps` list of accepted
gap records. An empty `routes` array and an empty `gaps` list are valid; duplicate
labels and unknown fields are `registry-invalid`. Every label must be produced by
a route in `models`; an unknown label is `reference-unknown`. Each gap is exactly
one of two forms: `{ "rating", "accepts", "reason" }` or `{ "capability",
"reason" }`. `accepts` is an integer from 1 to 10 recording the accepted rating
ceiling, `reason` is a required non-empty string (one line is the convention),
and any other shape, including `accepts` beside `capability`, is
`registry-invalid`. A gap's `rating` must be declared in `ratings` and a gap's
`capability` in `capabilities` (`cost` is not exempt; it needs a `ratings` entry
like any other rating name), or the load fails with `reference-unknown`. One
profile must not record two gaps for the same rating or the same capability
(`registry-invalid`); a rating and a capability that share a name are different
targets, and different profiles may record the same target. The loader does not
judge gap staleness or coverage here. No filters or profile selection are
implemented in this package.

```json
"profiles": {
  "budget": {
    "description": "Only a subset of routes.",
    "routes": ["model-a@harness-x/provider-a"],
    "gaps": [
      { "rating": "coding", "accepts": 6, "reason": "This set reaches coding 6." },
      { "capability": "browser", "reason": "This set has no browser route." }
    ]
  }
}
```

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
  profiles: Readonly<Record<string, Profile>>,        // always includes default
  profileProvenance: Readonly<Record<string, ProfileProvenance>>,
}
```

`Profile` is `{ readonly description?: string; readonly routes: readonly RouteLabel[];
readonly gaps?: readonly Readonly<ProfileGap>[] }`, where `ProfileGap` is the union
`RatingGap | CapabilityGap`: `{ rating: string; accepts: RatingValue; reason: string }`
or `{ capability: string; reason: string }`.
`ProfileProvenance` is `"implicit" | "declared"`. Both maps are always present.
Without a declared `default`, the loader supplies it with every label in the
order of `routes`, no description, and provenance `"implicit"`. It is the first
key, followed by declared profiles in file order. A declared `default` keeps its
file position and written membership. Profile names that are canonical array
indices, such as `"1"` or `"42"`, come before all other names in ascending numeric
order, as in any JavaScript object; `"01"` is not an index and keeps its file
position. Every declared profile retains its
`description` and written label order, with provenance `"declared"`, and carries
its written `gaps` records, in written order, only when the file wrote the key
(an empty written list stays empty); the implicit `default` never has a `gaps`
key, and nothing is synthesized. Nothing is
written to the file, and the digest still hashes only the original bytes.
`RegistryFile.profiles` is optional `Record<string, ProfileDeclaration>`, where
`ProfileDeclaration` is `{ description: string; routes: RouteLabel[]; gaps?: ProfileGap[] }`.
These profile types, including the three gap types, are exported by the package.
Profiles do not live under `registry` or `sections`; `RegistryFacts` is unchanged.

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

The package ships no code that produces ratings and no default bands. It ships the rating method in the `model-registry` agent skill, at `skills/model-registry/references/rating.md` (also exported as `@dungle-scrubs/model-registry/skills/model-registry/references/rating.md`). The prompt follows the RFC's five steps: ask which ratings, benchmarks and models matter; propose bands and wait for approval; read and record figures with `value`, `read` and `effort`; write ratings, overrides and handSet entries; run `model-registry check` and `model-router check` against the target registry file.

The prompt offers suggested benchmarks, each offered and never adopted without the user's approval: the Artificial Analysis Intelligence and Coding indices for `intelligence` and `coding` (the user fetches every figure with their own key), Artificial Analysis cost per task for route `cost` when the measured provider and effort match the route, and Arena WebDev `overall` as evidence for a hand-set `taste` (a suggested band, never a feed). Suggested bands come from a fixed decile method over the user's own pinned read, with the read identity recorded in the benchmark's `version` and the method in its `notes`; the package ships no band numbers. Figures measured above a model's `maxEffort` are stored under a separate benchmark key that no feed lists, with their measured effort, and never feed a rating.

## Profile builder

The `model-registry` agent skill lives in `skills/model-registry/`. Its `SKILL.md` holds the rules every request shares - one invocation of each CLI for every command, the target file, one question at a time, approval before any registry write, and both finishing checks - and sends each request to one reference: `references/new-registry.md` creates a first registry from a schema-valid skeleton, `references/build-profile.md` is the profile builder (also for adding a platform or model), `references/gaps.md` covers coverage, accepted gaps and check findings, `references/rating.md` is the rating method, and `references/snapshots.md` holds the model list snapshots and rebuilds. Each file is also exported under `@dungle-scrubs/model-registry/skills/model-registry/`. The profile builder builds one named profile end to end: an interview that asks one question at a time and skips facts the opening request already answered; model list discovery through local commands only, from harness lists, platform endpoints, local runtimes, the pinned models.dev catalog and cited research, in that order of evidence; aggregator narrowing before any aggregator read; each model list read saved as a JSON snapshot in `lists/` beside the target registry file under the contract `references/snapshots.md` documents; rebuild diffs approved before a snapshot is replaced; all rating work handed to `skills/model-registry/references/rating.md`; a proposal of membership, shared fact changes, ratings, bands and accepted gaps, approved before the registry is written; and the two finishing checks, `model-registry check` then `model-router check`, against the target registry file.

Pinned benchmark read files in `reads/` are never overwritten; an old read is removed only after the user approves and no benchmark in the registry names its source and version. A read is reused only when the source and exact version stored in the file match; a different read whose filename collides is saved with a numeric suffix.

A placeholder walkthrough of one build, from opening request through a rebuild, lives at [`examples/profile-walkthrough/`](../examples/profile-walkthrough/) in the repository (not shipped in the package).

## Error codes

| Code | Cause |
|---|---|
| `registry-missing` | no file at the resolved path |
| `registry-unreadable` | the file cannot be read or parsed |
| `format-missing` | no `format` field: not a version 1 registry |
| `format-unsupported` | a newer or older format major; the fix names upgrading model-registry for a newer format, and names `migrate` for an older format only when this release ships a step from it, otherwise it says to recreate the file as format 1 |
| `registry-invalid` | a shape error, an unknown field, `null`, or an override whose target does not match its rating (`cost` must target a route, any other rating a model) |
| `label-duplicate` | two routes with the same label |
| `reference-unknown` | an undeclared rating, capability, meter, benchmark, model or route label in the format's own sections: a model rating name, a route capability or meter, a calibration `feeds` or `handSet` rating name, a `feeds` benchmark name, an `overrides` rating, model or route, a profile route label, or a profile gap's rating or capability |
| `rating-mismatch` | a written rating that the stored table does not give and no override allows; the `fix` names the computed value (or that the table gives none) and the override that would allow the written value |
| `backup-exists` | `migrate` refused because a backup already sits beside the registry |

