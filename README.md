# model-registry

[![CI](https://github.com/dungle-scrubs/model-registry/actions/workflows/ci.yml/badge.svg)](https://github.com/dungle-scrubs/model-registry/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@dungle-scrubs/model-registry.svg)](https://www.npmjs.com/package/@dungle-scrubs/model-registry) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Every model you use, and how good each is, in one file.

Your registry is one JSON file that lists the models you can use, the harnesses that reach each one, and how you rate each model at the work you care about. [model-router](https://github.com/dungle-scrubs/model-router) reads it to pick a model for each job, so when a model comes out, drops off or earns a different rating, you change this file and every agent and app that routes through it follows. Profiles in the same file name sets of routes, such as a low-cost set, that a run can switch to without touching an agent. `model-registry check` validates the file before anything routes on it, and catches a rating that disagrees with its benchmark or a route that no longer exists. Without a registry, the model is picked by hand in each harness, named again in every agent config, and judged from memory.

```console
$ jq -c '.models["glm-5.3"] | {ratings, fixedEffort, route: .routes[0] | {harness, modelId, cost}}' ~/.config/model-registry/registry.json
{"ratings":{"coding":8,"guardrails":9,"intelligence":8,"taste":5,"truth":6},"fixedEffort":"xhigh","route":{"harness":"pi","modelId":"zai/glm-5.3","cost":10}}
$ model-registry check
{"format":1,"digest":"sha256:e380d8dd...","path":".../model-registry/registry.json"}
$ model-router '{"task":"explore","stakes":"low"}' | jq -c '.routes[0] | {label, effort}'
{"label":"glm-5.3@pi","effort":"xhigh"}
```

A route is one model reached through one harness, labelled `model@harness`, plus `/provider` when it goes through a named provider. Ratings are integers from 1 to 10, higher is better. A route's `cost` is rated the same way, so 10 is the cheapest. The router asks for `xhigh` because the model fixes its effort there. [How the three packages fit](#how-the-three-packages-fit) shows where the registry sits.

## Install

model-registry needs Node 22.14 or newer. Install it and start from the example registry, which uses placeholder names:

```sh
npm install -g @dungle-scrubs/model-registry
mkdir -p ~/.config/model-registry
cp "$(npm root -g)/@dungle-scrubs/model-registry/examples/registry.json" ~/.config/model-registry/registry.json
```

```console
$ model-registry check
{"format":1,"digest":"sha256:...","path":".../.config/model-registry/registry.json"}
```

`check` exits 0 when the file is valid. Otherwise it exits 4 and prints a JSON error on stderr that lists every problem with a `fix`. To route with the registry, model-router also needs a `router` section; the [model-router README](https://github.com/dungle-scrubs/model-router#install) shows it.

## Usage

These examples run against a real registry, so your models and output will differ.

### Add a model

Add an entry under `models`, and add the new route's label to each profile that should use it. Without a declared `default` profile, `default` already holds every route.

```json
"new-model": {
  "family": "qwen",
  "ratings": { "taste": 6 },
  "routes": [{ "harness": "pi", "provider": "lmstudio", "modelId": "new-model-mlx", "hosted": false, "privacyEligible": true, "cost": 10, "capabilities": ["repo-access"] }]
}
```

```console
$ model-registry check
{"format":1,"digest":"sha256:...","path":".../model-registry/registry.json"}
$ model-router '{"task":"implement","privacy":"secret"}' | jq -c '[.routes[].label]'
["qwen3.8-27b@pi/lmstudio","qwen3.6-35b-a3b@pi/lmstudio","qwen3.6-35b-a3b@pi/lmstudio-mini","new-model@pi/lmstudio"]
```

The new route ranks last because it has no `intelligence` rating yet. A route missing a capability the task needs, here `repo-access` for `implement`, is removed rather than ranked.

### Correct a rating

A rating listed in `calibration.handSet`, here `taste` and `cost`, is yours to change. A rating fed by a benchmark has to match the benchmark's table, so raising GLM-5.3's `intelligence` from 8 to 9 fails:

```console
$ model-registry check 2>&1 | jq -r '.error.fix'
Set the rating "intelligence" of model "glm-5.3" to 8 (the table gives 8), or add an entry to calibration.overrides with rating "intelligence", model "glm-5.3", value 9 and a non-empty reason.
```

To keep the 9, add the override to `calibration.overrides`. Its reason stays in the file, so whoever reads the rating next knows why it differs from the benchmark.

```json
{ "model": "glm-5.3", "rating": "intelligence", "value": 9, "reason": "Outperforms its index score on our repos." }
```

### Drop a model

Delete the model, then run both checks. Each lists every place that still names the model's routes.

```console
$ model-registry check 2>&1 | jq -r '.error.problems[].field'
$["profiles"]["default"]["routes"][19]
$["profiles"]["computer-use"]["routes"][2]
$ model-router check 2>&1 | jq -r '.error.problems[].fix'
Add the route "sonnet-5.5@claude" to the models section, or remove it from "explore-investigate".
```

model-registry checks the sections it owns, such as `profiles`. model-router checks its own sections, such as the `explore-investigate` policy here.

### Make a profile

```json
"low-cost": {
  "description": "The cheapest routes.",
  "routes": ["glm-5.3@pi", "minimax-m3@pi", "glm-5.3-flash@pi/zai"]
}
```

```console
$ MODEL_ROUTER_PROFILE=low-cost model-router '{"task":"implement"}' | jq -c '[.routes[].label]'
["glm-5.3@pi","glm-5.3-flash@pi/zai","minimax-m3@pi"]
$ model-router check 2>&1 | jq -r '.error.message, .error.problems[0].message'
declared profile coverage has 28 unrecorded gaps.
profile "low-cost", task "code-review", stakes "low": no route in profile "low-cost" reaches taste 7 (best 5).
```

A profile goes under `profiles`, and a run selects it by name. `model-router check` tests each declared profile against every task and stakes. Record each gap you accept in the profile's `gaps`, such as `{ "rating": "taste", "accepts": 5, "reason": "No cheap route has better taste." }`, or add a route that fills it.

### Let an agent rate models or build a profile

```console
$ ls "$(npm root -g)/@dungle-scrubs/model-registry/prompts"
profile-builder.md
rating.md
```

Point a coding agent at one of these prompts. `rating.md` asks which ratings, benchmarks and models matter, proposes band tables for your approval, records each figure you supply, writes the ratings, and runs `model-registry check`. `profile-builder.md` builds one profile end to end: it interviews you, reads the model lists your platforms offer, works through the gaps with you, and writes nothing to the registry until you approve.

### Read the registry from code

```ts
import { loadRegistry } from "@dungle-scrubs/model-registry";

const loaded = loadRegistry();
console.log(loaded.routes["opus-5.5@claude"].modelId);
console.log(loaded.registry.models["opus-5.5"].ratings);
console.log(Object.keys(loaded.profiles));
```

```text
claude-opus-5-5
{ coding: 9, guardrails: 9, intelligence: 9, taste: 8, truth: 9 }
[ 'default', 'computer-use' ]
```

`loadRegistry` is synchronous, finds the file the same way the CLI does, and validates it. It throws one `RegistryError` that lists every problem. Pass `{ path }` to name the file.

## Concepts

### How the three packages fit

```text
task ──▶ model-router ──▶ routes, best first ──▶ hcn run <harness> --model <id> --effort <level>
              ▲                                              │
              │                                              └─ retryable failure: next route
       model-registry
```

Together, the three packages route each job to a model and harness automatically, following your preferences. model-registry defines the registry file: the models you can use, the harnesses that reach them, and ratings for each. [model-router](https://github.com/dungle-scrubs/model-router) reads the registry, takes a task, and returns routes ranked best first. Each route is a harness, a model, and an effort. [hcn](https://github.com/dungle-scrubs/harness-cli-normalizer) runs the route. If the run fails with `retryable: true`, run the next route. [popeye](https://github.com/dungle-scrubs/popeye) is a harness built for hcn to drive, and a registry can list routes through it like any other harness. Each package also works on its own. hcn runs any harness and model you give it, and model-router ranks routes without running anything.

### Where ratings come from

You declare each rating name in `ratings` with a one-line description, and each model carries its values. `calibration` records how each rating was produced. A rating in `calibration.feeds` is computed from benchmark figures through a band table, and `check` fails any written value that disagrees unless an override with a reason allows it. A rating in `calibration.handSet`, such as `taste`, is your judgment and is never compared. The package never fetches a figure: you or your agent read them from sources you choose and record them in `calibration.figures`.

## Reference

### Commands

```text
model-registry check [--registry <path>]               validate the file; print its format, digest and path
model-registry migrate [--registry <path>] [--dry-run]   bring the file forward to the current format, with a backup
```

The registry path is `--registry`, then `MODEL_REGISTRY_FILE`, then `$XDG_CONFIG_HOME/model-registry/registry.json`, then `~/.config/model-registry/registry.json`.

### File sections

| Section | Holds |
|---|---|
| `format` | the format major, `1` |
| `ratings` | rating names, each with a one-line description |
| `capabilities` | capability names that routes can list and tasks can need, such as `repo-access` |
| `meters` | quota meters that routes draw on, with `spendToZero` for meters you are happy to drain |
| `models` | each model's `family`, `ratings`, `maxEffort` or `fixedEffort`, `notes` and `routes` |
| `calibration` | `benchmarks`, `feeds`, `handSet`, `figures` and `overrides`: how each rating was produced |
| `profiles` | named sets of route labels, each with a `description` and optional accepted `gaps` |
| any other | passed through untouched; model-router reads `router`, `tasks` and `policy` |

A route carries `harness`, `modelId` and `hosted`, and optionally `provider`, `privacyEligible`, `cost`, `capabilities`, `meter`, `responseSeconds`, `rateLimitRpm` and `notes`. Efforts follow the ladder `low < medium < high < xhigh < max`. `registry.schema.json` describes the whole file.

### Exit codes

| Exit | Meaning |
|---|---|
| 0 | the command succeeded |
| 1 | an internal fault (`internal-error`) |
| 2 | invalid usage (`usage-invalid`), or `migrate` refused because a backup already exists (`backup-exists`) |
| 4 | the registry file failed to load or validate |

### Error codes

| Code | Cause |
|---|---|
| `registry-missing` | no file at the resolved path |
| `registry-unreadable` | the file cannot be read or parsed |
| `format-missing` | no `format` field |
| `format-unsupported` | a format major this release does not read |
| `registry-invalid` | a shape error, an unknown field, or `null` |
| `label-duplicate` | two routes with the same label |
| `reference-unknown` | a name or label the file does not declare |
| `rating-mismatch` | a written rating that its table does not give and no override allows |
| `backup-exists` | `migrate` found a backup already beside the registry |

### Library

The package exports `loadRegistry`, `buildRouteLabel`, `RegistryError`, `EFFORT_LADDER` and `ROUTE_RATING_NAME`, with their types. It also ships `registry.schema.json`, `examples/registry.json`, `prompts/rating.md` and `prompts/profile-builder.md`.

### Security

The loader reads one file, never writes it, and makes no network calls. `migrate` writes the upgraded file and a backup beside it, and `--dry-run` writes nothing. The rating prompt has your agent read benchmark figures from sources you choose, using your own keys.

[docs/reference.md](docs/reference.md) holds the full contract: every rule the loader checks, the loader result, how `migrate` handles backups and symlinks, the rating method and the profile builder.

## Contributing

```sh
pnpm install
pnpm hooks:install     # lefthook: Biome and tsc on commit
pnpm verify            # lint, typecheck, build, tests
pnpm test:mutation     # Stryker; fails below a 60% mutation score
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), which release-please reads to cut releases.

## Status

model-registry is before 1.0, and the file is format 1. [docs/roadmap.md](docs/roadmap.md) lists planned work. It isn't a router: model-router ranks routes from it. It doesn't rate models or fetch benchmarks for you; its prompts walk an agent through rating, using your sources and with your approval. It isn't a model catalog either, and lists only what you add. If you use one model, you don't need a registry.

## License

MIT
