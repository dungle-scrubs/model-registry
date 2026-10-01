---
number: 01
title: "Shared model registry and router"
type: protocol
status: Accepted
author: "Kevin Frilot"
date: 2026-10-01
---

# RFC-01: Shared model registry and router

## Abstract

Today one agent skill holds the model registry, the engine that ranks
routes from it, and the operator's private registry data. Other skills
and the graybox application reach into it by relative path. This RFC
specifies two open source npm packages that replace it.
`@dungle-scrubs/model-registry` defines the registry file format and
ships a loader that validates a file. `@dungle-scrubs/model-router` turns
a query, or a work description, into an ordered list of routes. The RFC
fixes the file format, the query and answer contract, the configuration
and availability documents, the library and CLI surfaces, the release
rules, how each consumer uses the packages, and the order of the cutover.
Neither package ships personal registry data. Each user supplies their
own registry as configuration.

## Introduction

### Problem

The `choose-model` skill holds three things in one directory: the
registry data (`registry.json`), the ranking engine (`choose.ts`) and
the describe step (`routing-query.ts`, with the Jev client `jev.ts`).
The operator's data is private, and the engine assumes the operator's
setup in a few places: a private quota tool, provider names fixed in
code, and a fixed cost threshold. Other consumers depend on the
directory by relative path: `delegate`, `jev-sweep`, `interrogate`,
`audit-skills`, the operator's registry refresh, and graybox, which
also names models in its own source. Nobody else can use the engine.
A change to the data can break a consumer, and nothing records which
data produced a routing decision.

### What this RFC specifies

- Format version 1 of the registry file, and the `model-registry`
  loader and CLI.
- The router's own sections of that file: `router`, `tasks` and
  `policy`.
- Version 1 of the `model-router` contract: the query, the answer, and
  the coded errors, warnings and reasons.
- The router's `config.json` and the neutral availability document.
- The `model-router` library exports and CLI commands.
- The release rules for both packages.
- How `choose-model`, `delegate` and the other skills use the CLI, and
  how graybox uses the library.
- The rule each consumer follows when it walks the ranked routes.
- The order of the cutover, and what each consumer runs until it
  switches.

### What this RFC does not cover

These were ruled out of scope on the map. Each one has its reason there.

- Jev classifying the Owner's request in graybox. That is graybox's
  roadmap. The contract allows a later library caller with prose
  (`describe`).
- Whether graybox works without HCN. That is a graybox decision.
- Preparing graybox, HCN or Tether as a whole for open source.
- Merging graybox's `feat/model-routing` branch into `main`.
- A Primary route with fallback, and a quota source, in graybox. Both
  failed the fit check as features of the packages.
- A scrubber that removes private text before a hosted model sees it.
  It is a separate application.
- How graybox shows the chosen route in its application interface.
  graybox's own planning owns the display. This RFC fixes only the
  data graybox records.

This RFC also excludes things it declines on purpose: an HCN adapter,
any check of a route against a runner, an exported walk function, a
`harnesses` section, a label parser, the `models` and `matrix` read
views, and a migration step from today's format. Each is listed under
[Alternatives Considered](#alternatives-considered).

### Where the decisions come from

This RFC decides nothing new. It renders the decisions of the 19 closed
tickets of the map [Map: shared model registry][map] into one ordered
document. Each section names the tickets it renders. Where a later
ticket revised an earlier one, the later decision applies, and the
section says so where it matters.

Eight gaps between the tickets were found while drafting. Kevin decided
them on 2026-10-01, in the session that wrote this RFC:

1. The RFC type is `protocol`.
2. When `applyAvailability` runs again on routes that already carry
   `availability`, a route that no entry covers keeps its value and its
   place. Only an entry moves a route
   ([Availability rule](#availability-rule)).
3. The full sort order, written as an assumption in
   [Define the router's registry sections][t17], is normative
   ([Sort order](#sort-order)).
4. The `model-registry` CLI exits 2 on an unknown command or flag
   (`usage-invalid`) and when `migrate` finds an existing backup
   (`backup-exists`) ([Error Handling](#error-handling)).
5. A model's `fixedEffort` replaces, and its `maxEffort` caps, every
   requested level, with a warning on a lowering ([Effort](#effort)).
6. A route with no `cost`, or with no `responseSeconds` under
   `prefer: speed`, sorts below the routes that have it. File order is
   the last tie-break ([Sort order](#sort-order)).
7. `ratings` and `capabilities` map a name to a description string.
   `format` and `models` are required; the other declaration sections
   are optional ([Top-level sections](#top-level-sections)).
8. Warning and reason codes that no ticket named, and the names of the
   label builder and ladder exports, are named at implementation and
   listed in each package's documentation
   ([Left to implementation](#left-to-implementation)).

### Motivation

graybox is moving from route words fixed in code to configured routes
(its model-routing plan, rungs 5 to 8). The open source goal for this
work, graybox, HCN and Tether means the engine cannot assume one
operator's tools or data. Doing the split once, with a written contract,
gives the skills and graybox one ranking rule and one availability rule.

## Terminology

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD
NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be
interpreted as described in RFC 2119.

| Term | Meaning |
|---|---|
| **route** | One model reached through one harness. A route is identified by `harness`, `modelId` and an optional `provider`. `effort` is a setting carried with a route, not part of its identity. |
| **model key** | The key of a model in the registry's `models` section. It can differ from a route's `modelId`. |
| **label** | The string `<model key>@<harness>[/<provider>]` that names one route. `model-registry` owns the format and exports the builder. Example: `model-a@harness-x/provider-1`. |
| **registry**, **registry file** | One user's `registry.json`: the facts about models and routes, and the router's sections. It is configuration, not part of either package. |
| **digest** | `sha256:<hex>` of the registry file bytes as read. It identifies the registry data a decision used. |
| **rating** | An integer from 1 to 10 under a name that the registry's `ratings` section declares. Higher is better. For route `cost`, higher means cheaper. |
| **capability** | A name that the registry's `capabilities` section declares. A route lists the capabilities it has. |
| **meter** | A user-chosen name for one thing that runs out: a subscription, a key's budget, a rate limit. Routes on one subscription share one meter. |
| **availability entry** | A statement about one meter: `exhausted`, `projected` or `ok`. |
| **task** | A named work need in the registry: floors per stakes level, the ratings that order routes, needed capabilities and an effort level. |
| **inline need** | A work need stated in the query itself: `minimums`, `needs` and `effort`. |
| **floor** | A minimum rating. A route whose model meets every floor **clears** it. Other routes rank **below** the clearing routes. A floor never removes a route. |
| **hard limit** | A check that removes a route: privacy, excluded families and needed capabilities. Availability `exhausted` also removes a route. |
| **pin** | A route label in the query that the caller wants first. A pin always comes with a requirement fallback. |
| **policy** | A named registry entry that puts given routes first for a task. |
| **describe step** | The step that turns a work description into query fields through Jev. |
| **Jev** | TypeSafe's typed-judgment model. It answers yes/no and one-of questions. It never picks or ranks a model. |
| **consumer** | A program that uses the packages: the skills `choose-model`, `delegate`, `jev-sweep`, `interrogate`, `audit-skills`, the operator's registry refresh, and graybox. |
| **runner** | The program that runs a route, for example HCN. Neither package names a runner. |
| **walk** | A consumer's loop over the ranked routes that tries the next route after a failure. |
| **work seen** | A tool call or model output on the runner's event stream before a failure. |
| **operator** | The person who maintains a registry and runs the consumers on their machines. |
| **source** (graybox) | Where graybox gets its ordered routes: its own route `list`, or the `router`. |

## Protocol Overview

### The two packages

| | `@dungle-scrubs/model-registry` | `@dungle-scrubs/model-router` |
|---|---|---|
| Does | Defines the registry file format. Finds, reads and validates a file. Reports its digest. Builds route labels. | Ranks routes for a query. Turns prose into a query through Jev. Applies availability. Ships the Jev client. |
| Owns in `registry.json` | `format`, `ratings`, `capabilities`, `meters`, `models`, `calibration` | `router`, `tasks`, `policy` |
| Configuration | none | `$XDG_CONFIG_HOME/model-router/config.json`, optional |
| Library | `loadRegistry`, the label builder, the effort ladder, `RegistryError`, types | `rank`, `describe`, `listTasks`, `applyAvailability`, `dropExpired`, `askJev`, `JevError`, `RouterError`, types |
| CLI binary | `model-registry` (`check`, `migrate`) | `model-router` (rank, `tasks`, `check`) |
| Depends on | no parser (plain JSON) | `model-registry`, caret range on the major |
| Publishes | `registry.schema.json`, the example registry, the rating prompt | query, answer, error, config, availability and router-sections schemas |

Sources: [Draw the package boundary][t3], revised by
[Decide how a user supplies registry data][t6],
[Specify how the skills move to the CLI][t10] and
[Specify the rating method][t15];
[Define registry format version 1][t16];
[Define model-router's library API and CLI surface][t19].

The packages do not name HCN, check a route against it, or convert a
route to its input ([Decide whether the router contract assumes HCN][t13]).
The only link to a runner is a convention: the registry's `harness`
strings are the names the user's runner accepts.

### Participants and flow

```
                       registry.json (user's XDG config, private)
                                   |
                                   v
                     +----------------------------+
                     | model-registry loader      |  path order, validation,
                     | (format, facts, digest)    |  digest, route index
                     +----------------------------+
                                   |
        work description           v                 config.json (optional)
     (optional, never secret) +----------------------------+   availability entries
   -------------------------> | model-router               | <--------------------
            partial query     |  describe (Jev) -> query   |  (CLI: --availability)
   -------------------------> |  rank -> answer            |  (library: caller's)
                              +----------------------------+
                                   |  answer: ordered routes, removed,
                                   |  warnings, routerVersion, registryDigest
                                   v
                      consumer walk (delegate, graybox)
                                   |  harness, modelId, provider, effort
                                   v
                              runner (HCN)
```

### How each consumer calls

- **Skills** call the CLI for every ranking, unpinned:
  `npx --yes --prefer-online --package=@dungle-scrubs/model-router@latest model-router '<query>'`.
  The agent reads the warnings and each `fix`, and saves the answer.
  `delegate.ts --choice <file>` walks the saved answer. Skill scripts
  import only `askJev`, `JevError` and the availability functions.
  Those imports are bundled into each script at deploy
  ([Specify how the skills move to the CLI][t10]).
- **graybox** imports the library at an exact version. Under its router
  source it calls `loadRegistry`, then `listTasks` and `rank`, with one
  loaded registry. Under its list source it uses only
  `applyAvailability` and `dropExpired`
  ([Specify how graybox uses the library][t11],
  [Decide whether graybox runs without the router][t12]).
- **The operator's registry refresh** imports `model-registry` only. Its
  routing diff runs the `model-router` CLI twice, once per registry
  file, and compares the answers ([Specify the rating method][t15]).

## Message Formats

All schema files use JSON Schema 2020-12. Each package exports
TypeScript types that match its schemas. Examples use placeholder names
only.

### Coded objects

Every error, warning, reason and note in both packages is a coded
object ([Define contract version 1][t5], decision 13):

| Field | Required | Content |
|---|---|---|
| `code` | yes | A stable kebab-case string. Programs branch on it. |
| `message` | yes | One human-readable sentence. |
| `field` | no | A JSON path into the input that caused it. |
| `fix` | no | The next action, one sentence. Agents act on it. |

A consumer MUST accept a `code` it does not know.

### Registry file format version 1

Owner: `model-registry`. Source: [Define registry format version 1][t16],
with [Decide how a user supplies registry data][t6],
[Decide whether the router contract assumes HCN][t13] and
[Specify the rating method][t15].

#### Location and encoding

- The file is plain JSON, named `registry.json`.
- The loader MUST resolve the path in this order: an explicit path (the
  library argument, or `--registry <path>` on either CLI), then the
  `MODEL_REGISTRY_FILE` environment variable, then
  `$XDG_CONFIG_HOME/model-registry/registry.json`. When
  `XDG_CONFIG_HOME` is unset, the directory MUST be
  `~/.config/model-registry/` on every platform, macOS included.
- `model-router` MUST pass its `--registry` flag to the loader and MUST
  NOT add a path rule of its own.
- A missing file is an error that names the path the loader looked for
  and points at the example registry. The loader MUST NOT load the
  example in place of a missing file.
- The loader MUST NOT change the file.

#### Top-level sections

| Section | Owner | Content |
|---|---|---|
| `format` | `model-registry` | REQUIRED. The integer `1`. |
| `ratings` | `model-registry` | OPTIONAL. Maps each rating name to a one-line description string. |
| `capabilities` | `model-registry` | OPTIONAL. Maps each capability name to a one-sentence description string. |
| `meters` | `model-registry` | OPTIONAL. Maps each meter name to an object with an optional `spendToZero: true` and optional `notes`. |
| `models` | `model-registry` | REQUIRED. Models and their routes. |
| `calibration` | `model-registry` | OPTIONAL. The user's benchmark choice, figures and overrides. |
| `router` | `model-router` | REQUIRED by `model-router`. Router-wide data. |
| `tasks` | `model-router` | OPTIONAL. Named work needs. |
| `policy` | `model-router` | OPTIONAL. Named policies. |

An absent OPTIONAL section declares nothing. A minimal file is
`format`, `models` and, for `model-router`, `router`. Example:

```json
"ratings":      { "coding": "Writes and changes code to a spec." },
"capabilities": { "browser": "Can drive a web browser." },
"meters":       { "plan-a": { "spendToZero": true } }
```

- The loader MUST read `format` before anything else. A file without
  `format` fails as "not a version 1 registry" (`format-missing`). A
  number higher than the loader knows fails with "upgrade
  `model-registry`" (`format-unsupported`).
- The sections `model-registry` defines are closed. An unknown field
  inside `ratings`, `capabilities`, `meters`, `models`, a route, or
  `calibration` MUST be an error that names the field. Free text goes in
  `notes`.
- Any other top-level section MUST pass through the loader untouched.

#### Unknown values

A rating, capability or optional fact that is not known is an absent
key. `null` MUST be a validation error. There is one spelling for
unknown.

#### Models

| Field | Required | Absent means |
|---|---|---|
| `family` | yes | - |
| `ratings` | no | every rating unknown |
| `maxEffort` | no | no ceiling |
| `fixedEffort` | no | no pinned level |
| `notes` | no | - |
| `routes` | yes, MAY be empty | - |

- `ratings` is `{ "<rating name>": <integer 1-10> }`. Every name MUST be
  declared in `ratings`.
- `maxEffort` and `fixedEffort` are levels on the effort ladder.
- `routes` is in order of preference among otherwise equal routes. A
  model with no routes is allowed, so a model can leave routing and keep
  its ratings checked.

#### Routes

| Field | Required | Absent means |
|---|---|---|
| `harness` | yes | - |
| `modelId` | yes | - |
| `provider` | no | no provider, and none in the label |
| `hosted` | yes | - |
| `privacyEligible` | no | not eligible |
| `capabilities` | no | none |
| `cost` (rating 1-10, higher is cheaper) | no | unknown |
| `meter` | no | unmetered |
| `rateLimitRpm` | no | unknown |
| `responseSeconds` | no | unknown |
| `notes` | no | - |

- `hosted` is required because a wrong guess either way is a privacy
  fault.
- `harness`, `modelId` and `provider` are plain strings. The format MUST
  NOT check them against any list of harnesses or providers.
- A route that lists an undeclared capability, or names an undeclared
  meter, MUST be an error.
- The label is `<model key>@<harness>[/<provider>]`. Effort is not part
  of it. Two routes with the same label MUST be an error
  (`label-duplicate`).

#### Effort ladder

The ladder is fixed in the format: `low < medium < high < xhigh < max`.
`model-registry` exports it. The registry, `model-router`'s
`config.json` and a query can each be validated against it alone. A new
level is a minor release.

#### `calibration`

The section records how ratings were produced. Its shape:

```json
"calibration": {
  "benchmarks": {
    "index-a":       { "source": "https://example.org/a", "field": "index", "version": "4.3",
                       "direction": "higher", "bands": [ {"at": 50, "score": 9}, {"at": 40, "score": 8} ] },
    "cost-per-task": { "source": "https://example.org/a", "field": "costPerTask", "version": "4.3",
                       "direction": "lower",  "bands": [ {"at": 0.5, "score": 9}, {"at": 1.0, "score": 8} ] }
  },
  "feeds":   { "intelligence": ["index-a"], "coding": ["bench-b", "bench-c"], "cost": ["cost-per-task"] },
  "handSet": ["taste"],
  "figures": {
    "model-a":           { "index-a":       { "value": 52.1, "read": "2026-09-30", "effort": "high" } },
    "model-a@harness-x": { "cost-per-task": { "value": 0.32, "read": "2026-09-30", "effort": "high" } }
  },
  "overrides": [
    { "rating": "cost",   "route": "model-a@harness-y", "value": 10, "reason": "subscription, no per-task price" },
    { "rating": "coding", "model": "model-b",           "value": 7,  "reason": "benchmark row is at a higher effort" }
  ]
}
```

- Bands live with their benchmark. The table version is the
  benchmark's `version`. With `direction: higher`, a figure at or above
  `at` takes `score`. With `lower`, a figure at or below `at` takes it.
  The first band that matches wins.
- A rating fed by several benchmarks is the floor of the mean of their
  scores. A missing figure is skipped. A rating with no figure left is
  absent.
- Figures are keyed by model key for model ratings, and by route label
  for `cost`. Each figure records its value, the date read and the
  effort level it was measured at.
- Every written value of a rating in `feeds` MUST be either computed
  from figures or listed in `overrides` with a `reason`. A route with no
  published cost therefore carries an override.
- A rating in `handSet` MUST NOT appear in `feeds` and needs no
  override.
- Figures MAY name a model or route the file does not declare. The
  loader checks their shape and skips the rating check for them.
- `notes` is allowed on `calibration` and on each benchmark.

#### Rating check

The loader MUST look up each stored figure in its table and compare the
result with the written rating. A written rating that differs and is not
an override MUST fail the load with `rating-mismatch`. The problem's
`fix` names the computed value and the override that would allow it. A
file that contradicts its own stated basis is broken, not missing data
([Define registry format version 1][t16], decision 6, which refines
[Decide how a user supplies registry data][t6], decision 6).

#### References between sections

`model-registry` MUST validate every reference inside its own sections:
a route's `meter`, rating and capability names, `feeds`, `handSet` and
`overrides`. An unknown reference is `reference-unknown`. `model-router`
validates the labels and names that `router`, `tasks` and `policy` use.

#### The loader's result

```ts
loadRegistry({ path?: string }) -> {
  path:     string,          // the resolved path
  digest:   "sha256:<hex>",  // of the file bytes as read
  format:   1,
  registry: { ratings, capabilities, meters, models, calibration },
  routes:   { "<label>": { model: "<model key>", ...route facts } },
  sections: { "<name>": <untouched> }
}
```

- The loader MUST hash the whole file as read. Reformatting the file, or
  editing `calibration`, changes the digest although routing does not
  change. That cost is accepted: `tasks` and `policy` change routing as
  well as the facts, and anyone can reproduce the digest with a standard
  checksum tool.
- `routes` is the index by label. A consumer reads registry facts there,
  because the router's answer does not copy them.
- `sections` holds `router`, `tasks`, `policy` and any other section the
  format does not define.
- On failure the loader throws one `RegistryError` that lists every
  problem (see [Error Handling](#error-handling)).

### Router sections of the registry file

Owner: `model-router`. Source: [Define the router's registry sections][t17].

```json
"router": {
  "rank": ["intelligence", "taste"],
  "questions": { "browser": "Does the work require driving a web browser?" }
},
"tasks": {
  "implement": {
    "description": "Write or change code to a stated spec.",
    "minimums": {
      "low":    { "coding": 6, "taste": 3 },
      "normal": { "coding": 7, "taste": 5 },
      "high":   { "coding": 8, "taste": 6 }
    },
    "rank": ["coding", "taste"],
    "needs": ["repo-access"],
    "effort": "high"
  }
},
"policy": {
  "explore-first": {
    "task": "explore", "stakes": ["normal", "high"],
    "routes": [ { "route": "model-a@harness-x", "effort": "medium" } ],
    "reason": "Fast enough for code navigation.", "since": "2026-09-30"
  },
  "settled-implement": {
    "task": "implement", "stakes": ["low", "normal"], "spec": "settled",
    "routes": [ { "route": "model-b@harness-y" }, { "route": "model-c@harness-y", "effort": "high" } ],
    "reason": "Settled specs go off the expensive routes."
  }
}
```

#### `router`

- `router` with a non-empty `rank` is REQUIRED. A file without
  `router.rank` fails with `registry-sections-invalid`, and the `fix`
  shows the line to add.
- `router.rank` is an ordered list of rating names. It orders routes
  when the query has no known task: an unknown task, or inline
  `minimums` alone.
- `router.questions` is OPTIONAL. It maps a declared capability name to
  a yes/no question sentence that the describe step asks.

#### `tasks`

| Field | Required | Absent means |
|---|---|---|
| `description` | yes, one line | - |
| `minimums` | yes, with all of `low`, `normal` and `high` | - |
| `rank` | yes, not empty | - |
| `needs` | no | no required capability |
| `effort` | no | the `config.json` default |

- `minimums.<stakes>` names ratings from the `ratings` section. Today's
  `facet`, and its fallback to intelligence, are dropped. A coding task
  floors `coding`.
- `rank` is an ordered list of rating names that orders routes (see
  [Sort order](#sort-order)).
- The field names match the query: today's `requires` becomes `needs`,
  and `reasoning` becomes `effort`.
- graybox's Primary and the describe step both choose a task by its
  `description`.
- `tasks` is OPTIONAL. Absent means no tasks. A named task then gets the
  unknown-task warning.

#### `policy`

- Each policy is a named entry with `task`, `stakes` (a list of stakes
  levels), `routes`, a REQUIRED `reason`, an OPTIONAL `since`, and an
  OPTIONAL `spec`.
- Each policy route has `route` (a label) and an OPTIONAL `effort`.
- A policy without `spec` applies whatever the query's `spec` is. A
  policy with `"spec": "settled"` applies only to a `spec: settled`
  query. `spec: settled` triggers nothing else.
- At most one policy applies to a query. A policy with `spec` beats one
  without. Two policies that could match the same query at the same
  level (the same task, an overlapping stakes level, the same `spec`
  condition) MUST make the file invalid.
- A policy `effort` above the model's `maxEffort`, or different from its
  `fixedEffort`, MUST make the file invalid.
- `policy` is OPTIONAL. Absent means no policy applies.

#### Validation

Every problem in `router`, `tasks` and `policy` MUST be an error,
`registry-sections-invalid`, with one problem per finding in the shape
of `model-registry`'s `problems[]`. The sections are closed: an unknown
field is an error. The errors cover a wrong shape; a rating, capability,
task or route label that the file does not declare; an effort level not
on the ladder; a policy effort against the model's limits; and two
policies that tie. Known cost: removing a route from routing also needs
an edit to every policy that names it.

### Query

Owner: `model-router`, contract version 1. Source:
[Define contract version 1][t5], decisions 2 to 10.

| Field | Type | Required | Default | When the value is not in the registry |
|---|---|---|---|---|
| `task` | string | `task` or `minimums` | none | ranked by `router.rank`, warning |
| `minimums` | object, rating name to number | `task` or `minimums` | none | every route counts as below that floor, warning |
| `needs` | list of strings | no | `[]` | every route lacking it is removed, warning |
| `effort` | string | no | the task's level, else the `config.json` default | above the ceiling: lowered, warning; not on the ladder: ignored, the default used, warning |
| `pin` | route label | no; needs `task` or `minimums` | none | the pin is not used, with a reason |
| `stakes` | `low`, `normal`, `high` | no | `normal` | selects the task's floor set; no effect on an inline-only need |
| `prefer` | `cost`, `speed` | no | `cost` | - |
| `privacy` | `normal`, `secret` | no | `normal` (none with `--describe`) | - |
| `excludeFamilies` | list of strings | no | `[]` | an unknown family excludes nothing, warning |
| `spec` | `open`, `settled` | no | `open` | no matching policy: normal ranking, warning |

- A query MUST carry `task`, or `minimums`, or both. `"minimums": {}`
  states "no floor" explicitly. A query with neither is `query-invalid`.
- A `pin` without `task` or `minimums` is `query-invalid`.
- A field the contract does not define MUST be `query-invalid`. Input is
  strict, so a misspelled `privacy` cannot silently drop `secret`.
- Task plus inline fields: `minimums` replaces the task's floor for each
  rating it names, at the query's stakes. `needs` adds to the task's
  needs. `effort` replaces the task's level.
- With `--describe` (or the library's `describe`), the partial query
  MUST state `privacy`. The default does not apply there.

### Answer

Owner: `model-router`, contract version 1. Source:
[Define contract version 1][t5], decisions 11 and 12, with the
`describe` field from [Specify the describe step's contract][t14].

| Field | Content |
|---|---|
| `contract` | `1` |
| `routerVersion` | the `model-router` package version |
| `registryDigest` | `sha256:<hex>`, the loader's `digest` |
| `query` | the query as applied, with defaults and describe-filled fields |
| `pin` | `null` without a pin; else `{ label, used, reason }` |
| `routes` | one ordered list of routes, possibly empty |
| `removed` | each route removed by a hard limit or by `exhausted`: `{ label, reason }` |
| `warnings` | a list of coded objects |
| `availabilityNote` | a coded object saying why availability was not applied, or `null` |
| `describe` | the describe block, or `null` without `--describe` |

`routerVersion` and `registryDigest` together are the source identity a
consumer records.

#### Answer route

Each route carries four groups of fields and nothing else:

| Group | Fields |
|---|---|
| Identity | `label`, `model` (the model key), `harness`, `modelId`, `provider` (MAY be absent) |
| How to run it | `effort` (MAY be absent when no level is known) |
| Facts to run it safely | `hosted`, `family`, `meter` (MAY be absent) |
| Placement | `placedBy` (`pin`, `policy` with the policy name, or `rank`), `floor` (`clears`, `below` or `skipped`), `availability`, `reasons` (coded objects) |

Other registry facts (cost, ratings, capabilities, notes, rate limit,
response time) are not copied. A consumer reads them from
`model-registry`'s `routes` index by label. When `effort` or `provider`
is absent, a consumer MUST omit the matching runner flag.

`availability` takes one of five values (see
[Availability rule](#availability-rule)): `ok`, `projected`,
`exhausted`, `unknown`, `unmetered`.

#### Describe block

| Field | Content |
|---|---|
| `model` | the Jev model that answered, or `null` when Jev failed |
| `taskGate`, `capabilityThreshold` | the values applied |
| `task` | `source` (`caller`, `jev`, or `inline-need` when `minimums` was given), `confidence`, and `candidates`: the top choices with probabilities |
| `needsAdded` | each added capability with its probability |
| `usage` | Jev's token counts, or `null` |

The describe step's warnings go in the answer's `warnings` list.

### Router configuration: `config.json`

Owner: `model-router`. Source:
[Define the router's configuration and availability input][t18], with
the `describe` group from [Specify the describe step's contract][t14].

```json
{
  "$schema": "https://example.invalid/config.schema.json",
  "effort":       { "ceiling": "xhigh", "default": "medium" },
  "availability": { "command": ["availability-to-neutral", "--json"], "timeoutSeconds": 10, "maxAgeSeconds": 300 },
  "describe":     { "taskGate": 0.85, "capabilityThreshold": 0.5, "jevModel": "<the package's pinned Jev model>" }
}
```

| Key | Default | Rule |
|---|---|---|
| `effort.ceiling` | `xhigh` | a ladder level |
| `effort.default` | `medium` | a ladder level, not above `effort.ceiling` |
| `availability.command` | none | an argv array, run with no shell |
| `availability.timeoutSeconds` | `10` | a positive number |
| `availability.maxAgeSeconds` | `300` | the staleness bound, for command output and for a file |
| `describe.taskGate` | `0.85` | a probability |
| `describe.capabilityThreshold` | `0.5` | a probability |
| `describe.jevModel` | the Jev model the package pins | a Jev model name |

- Path order: `--config <path>` or the library's `config` option, then
  `MODEL_ROUTER_CONFIG`, then `$XDG_CONFIG_HOME/model-router/config.json`.
- When no file is at the XDG path, every default applies and no warning
  is added. An explicit path that does not exist, or an invalid file,
  MUST be `config-invalid`.
- Every key is OPTIONAL. The schema is closed: an unknown key is
  `config-invalid`. `$schema` is allowed for editor support.
- A default above the ceiling MUST be `config-invalid`. The file is
  validated against the ladder without loading the registry.
- The file holds no registry path and no Jev key. The key comes from the
  `TYPESAFE_API_KEY` environment variable.
- A user who needs a pipe in the availability command names a script.

### Availability document

Owner: `model-router`. Source:
[Decide how availability and quota reach the engine][t4], refined by
[Define the router's configuration and availability input][t18].

```json
{
  "format": 1,
  "generatedAt": "2026-10-01T04:00:00Z",
  "entries": [
    { "meter": "plan-a", "status": "projected", "resetsAt": "2026-10-01T09:00:00Z", "percentRemaining": 12, "note": "weekly window" },
    { "meter": "key-b", "status": "exhausted" }
  ]
}
```

- `format`, `generatedAt` and `entries` are REQUIRED. Each entry needs
  `meter` and `status` (`exhausted`, `projected` or `ok`). `resetsAt`,
  `percentRemaining` and `note` are OPTIONAL.
- Unknown fields are ignored.
- A broken document MUST NOT fail routing. A wrong top level (not JSON,
  no `generatedAt`, no `entries` array, an unknown `format`) means the
  CLI ranks without availability and fills `availabilityNote`. A single
  bad entry is skipped with a warning. The other entries still apply.
- An entry with an unknown status changes nothing.
- Several entries on one meter: the worst status decides, then the
  lowest `percentRemaining`.
- The package never names a quota tool. A user converts their own
  source into this document. The operator's converter from the
  operator's quota tool stays private.

### Consumer formats

These formats belong to the consumers, not to the packages. They are in
this RFC because the consumers share the codes by convention.

#### `delegate`'s report

Source: [Specify how the skills move to the CLI][t10], decision 10.

Each entry in `attempts` gains `workSeen` (boolean), `code` and `fix`.
The field `route` keeps the route label.

| `code` | When | `outcome` |
|---|---|---|
| `route-refused` | class `rejected` | `advanced` |
| `route-failed-before-work` | class `native`, no work seen | `advanced` |
| `route-unavailable` | a `retryable: true` class, no work seen | `advanced` |
| `failed-after-work` | `native` or a retryable class, work seen; the report carries `sessionId` | `stopped` |
| `work-verdict` | class `task` or `budget` | `stopped` |

A new `status`, `no-route`, covers an answer whose `routes` list is
empty. `delegate` runs nothing and copies the answer's `removed` and
`warnings` into the report. `intended` is `routes[0].label`, or `null`.

#### graybox's `routing` section

Source: [Specify how graybox uses the library][t11].

```json
{
  "routing": {
    "source": "router",
    "defaultNeed": { "task": "general" },
    "primary": { "harness": "harness-a", "modelId": "model-p", "effort": "high" },
    "routes": [
      { "harness": "harness-a", "modelId": "model-x", "provider": "provider-1", "meter": "provider-1-plan" },
      { "harness": "harness-a", "modelId": "model-y", "effort": "medium", "evidence": "Qualified on a fixture Task." },
      { "harness": "harness-b", "modelId": "model-x", "sandbox": "full", "access": "host" }
    ]
  }
}
```

- The section lives in graybox's existing XDG `config.json`.
- `source` is `list` or `router`. Absent means `list`.
- `primary` is one fixed route for the Primary. It is never ranked or
  walked.
- `routes` are the admitted Worker routes in written order. Listing a
  route admits it.
- `registry` is an OPTIONAL explicit registry path. Without it, the
  loader's path order applies.
- `defaultNeed` is the need used under the router source when the
  Primary states none.
- An entry uses the contract's route fields (`harness`, `modelId`,
  optional `provider`, optional `effort`, optional `meter`), plus
  graybox-only fields: the Codex sandbox, access limits and `evidence`.
  A provider is a separate field, never part of `modelId`.
- graybox's label is `<modelId>@<harness>[/<provider>]`, built from the
  entry, on both sources. Under the router source graybox also stores
  the registry label from the answer.

## State Machine

### Loading

```
START -> RESOLVE_PATH -> READ -> CHECK_FORMAT -> VALIDATE -> LOADED
READ          -> FAIL (registry-missing | registry-unreadable)
CHECK_FORMAT  -> FAIL (format-missing | format-unsupported)
VALIDATE      -> FAIL (registry-invalid | label-duplicate | reference-unknown | rating-mismatch)
```

`VALIDATE` collects every problem before it fails. `model-router` then
validates `router`, `tasks` and `policy` and loads `config.json` before
it ranks. A failure there is `registry-sections-invalid` or
`config-invalid`.

### Ranking

`rank` is synchronous and pure over its inputs. It MUST NOT read the
clock, run a subprocess or make a network call. The same registry,
configuration, query and availability entries MUST give the same
answer. Sources: [Define contract version 1][t5],
[Define the router's registry sections][t17],
[Define the router's configuration and availability input][t18]. The
steps run in this order:

1. **Validate the query.** A shape or vocabulary error throws
   `query-invalid`.
2. **Resolve the need.** Take the task's floors at the query's stakes,
   its `rank`, `needs` and `effort`. Apply the inline fields over them.
   An unknown task adds a warning. With no known task, the order list is
   `router.rank`.
3. **Apply the hard limits.** Remove every route that fails one, with a
   reason:
   - `privacy: secret`: a route without `privacyEligible: true`.
   - `excludeFamilies`: a route whose model's family is listed.
   - `needs`: a route that does not list every needed capability.
4. **Place the pin.** The pin is used when the label exists and the
   route passed the hard limits. A used pin goes first, with
   `placedBy: pin` and `floor: skipped`, and the fallback ranking
   follows without it. Otherwise the answer is the fallback ranking
   alone, `pin.used` is `false`, and `pin.reason` names the cause: an
   unknown label, a named hard limit, or `exhausted` (step 8).
5. **Place the policy.** At most one policy applies. Its routes follow
   the pin in written order, with `placedBy: policy` and
   `floor: skipped`. A policy route that a hard limit removed is in
   `removed`, and a warning names the policy. No route appears twice.
6. **Sort the rest.** See [Sort order](#sort-order) below.
7. **Resolve effort** for each route. See [Effort](#effort).
8. **Apply availability.** Call the availability rule on the full
   ordered list, after the pin and the policy have placed their routes.
   Availability applies to a pin or policy route as to any route: an
   `exhausted` pin is removed and reported as not used, and a
   `projected` one moves below the healthy routes.
9. **Build the answer.** An empty `routes` list is an answer, not an
   error.

#### Sort order

Within the routes that step 6 sorts, routes that clear every floor come
first and routes `below` a floor come after them. A model with no value
for a floor's rating counts as below that floor. This sort order is
normative (Kevin, 2026-10-01; it was an assumption in
[Define the router's registry sections][t17]):

- **Clearing routes, `prefer: cost`:** cost (higher rating, so cheaper,
  first), then the `rank` ratings in turn, highest first, then the
  model's route order.
- **Clearing routes, `prefer: speed`:** response time first, then the
  same order as `prefer: cost`.
- **Routes below a floor:** the `rank` ratings in turn, then cost, then
  route order.
- A route whose model lacks a `rank` rating sorts below every route that
  has it. A route with no `cost`, or with no `responseSeconds` under
  `prefer: speed`, sorts below every route that has it (Kevin,
  2026-10-01).
- The last tie-break is file order.

Example: task `implement` with `rank: ["coding", "taste"]` at normal
stakes keeps routes with `coding >= 7` and `taste >= 5` as clearing and
orders them cheapest first, then by `coding`, then by `taste`. A query
for the misspelled task `implemnt` orders every route that passed the
hard limits by `router.rank` and adds the unknown-task warning.

An unknown task ranks most capable first, never cheapest first, because
a misspelled task would otherwise send work to the cheapest route.

#### Effort

Sources: [Define contract version 1][t5], decision 9;
[Define the router's registry sections][t17], decision 9. Kevin fixed
the reading of "the default" on 2026-10-01: it is whatever level was
requested.

1. The requested level is the policy route's `effort` when stated, else
   the query's `effort`, else the task's `effort`, else
   `effort.default`.
2. A model's `fixedEffort` replaces the requested level.
3. A model's `maxEffort` caps the level. A lowered level adds a
   warning.
4. `effort.ceiling` caps every level last, including a level named by a
   task, a pin, a policy or a query. A lowered level adds a warning. It
   is never an error.
5. The router never emits `max` under the default ceiling.
6. A route MAY carry no `effort` when no level is known.

### Availability rule

`applyAvailability` is the one definition of the rule. The engine calls
it in step 8. `delegate` and graybox call it in their walks. graybox's
list source calls it with no registry. Sources:
[Decide how availability and quota reach the engine][t4],
[Define the router's configuration and availability input][t18].

```ts
applyAvailability<R extends { label: string; meter?: string }>(
  routes: readonly R[],
  entries: readonly AvailabilityEntry[],
  options?: { spendToZero?: readonly string[] },
): AvailabilityResult<R>          // { routes, removed, warnings }

dropExpired(entries: readonly AvailabilityEntry[], now: Date): AvailabilityEntry[]
```

- The function reads only `label` and `meter`. It returns the caller's
  own objects in the new order, each with `availability` set and any
  reason appended to `reasons`.
- `spendToZero` is a list of meter names. The engine passes the meters
  the registry marks. graybox passes none.
- `dropExpired` removes entries whose `resetsAt` has passed. The clock
  is the caller's argument.

| Value | When | Effect |
|---|---|---|
| `ok` | an entry for the route's meter says `ok` | none |
| `projected` | the worst entry says `projected` | moves below every healthy route, reason `meter-projected`. On a `spendToZero` meter it keeps its place, reason `meter-projected-spend-to-zero`. |
| `exhausted` | the worst entry says `exhausted` | removed, reason `meter-exhausted`. When exhaustion would remove every route, none is removed: each stays with `exhausted`, and the warning `availability-exhausted-all` is added. |
| `unknown` | the route names a meter, and no usable entry covers it, or availability was not read | none |
| `unmetered` | the route names no meter | none; availability never affects it |

- Healthy routes keep their input order. Demoted routes keep their input
  order among themselves.
- **Only an entry moves a route** (Kevin, 2026-10-01). When no entry
  covers a route's meter, a route that already carries `availability`
  keeps its value and its place in the input order. Otherwise it gets
  `unknown` or `unmetered`. Example: an answer orders `model-a`
  (`ok`), `model-s` (`projected`, on a spend-to-zero meter, so in its
  place), `model-c` (`unmetered`). `model-a` fails on quota. The walk
  adds one `exhausted` entry for `model-a`'s meter and calls the
  function on `[model-s, model-c]`. The result is `model-s`
  (`projected`), then `model-c` (`unmetered`), in that order, without a
  `spendToZero` list.

### Describe step

Source: [Specify the describe step's contract][t14], with the library
form from [Define model-router's library API and CLI surface][t19].

```
INPUT(text, partialQuery)
  -> CHECK_PRIVACY   privacy absent        -> FAIL query-invalid (field: privacy)
                     privacy: secret        -> FAIL describe-private
                     empty text             -> FAIL query-invalid
  -> ASK_JEV         task question only when partialQuery has neither task nor minimums;
                     one capability question per router.questions entry, always
  -> GATE            task confidence >= taskGate     -> use Jev's task
                     task confidence <  taskGate     -> use the guess, warning task-uncertain,
                                                        candidates in the describe block
                     capability probability >= capabilityThreshold -> add to needs
  -> RANK (CLI only: rank(filledQuery) and merge the describe block)
JEV_FAILED (no key, failed request, unusable answer)
  task needed     -> FAIL describe-failed (CLI exit 5), carrying Jev's own code
  task not needed -> continue, warning capabilities-unasked with Jev's code
```

- The step fills `task` and adds to `needs`. Every other field is the
  caller's. A capability answer only adds to `needs`. It never removes a
  capability the caller named.
- The task question is one choice over the declared tasks, with each
  task's `description` as its criterion. A task added to the registry is
  offered with no package change.
- The package asks no `stakes` question and no question about secret
  material.
- No request leaves the machine before `CHECK_PRIVACY` passes. Hosted
  Jev never receives text from a `privacy: secret` call.
- The package keeps no local-model fallback for the describe step.
- The Jev client's missing-key message names only `TYPESAFE_API_KEY`. It
  names no credential tool and no path.

### Consumer walk

The walk lives in each consumer. Neither package exports a walk
function, a walk table or a runner's failure classes. This is the one
written rule that `delegate` and graybox both follow
([Decide where the fallback walk lives][t9]).

```
ATTEMPT(route) -> SUCCESS                                     (terminal)
ATTEMPT(route) -> FAILURE
  FAILURE, class rejected                         -> ADVANCE
  FAILURE, class native, no work seen             -> ADVANCE
  FAILURE, retryable class, no work seen          -> MARK_METER -> ADVANCE
  FAILURE, native or retryable, work seen         -> STOP (report sessionId for a resume)
  FAILURE, class task or budget                   -> STOP
MARK_METER: when the route names a meter, add { meter, status: exhausted, resetsAt? }
            and call applyAvailability on the remaining routes
ADVANCE: record the attempt (label, class, runner message, code, fix);
         next route, or NO_ROUTE when none is left            (terminal)
```

- Every advance MUST be recorded, so a wrong registry entry stays
  visible even when a later route succeeds.
- A pinned route in `delegate` falls back like any other route.
- graybox MUST NOT walk past a route the Owner named. It refuses and
  says why.
- The class names are HCN's. A consumer that uses another runner maps
  that runner's failures to the same four outcomes.

## Error Handling

### `model-router`

Source: [Define contract version 1][t5], decision 14, with exit 5 from
[Specify the describe step's contract][t14].

| Outcome | CLI exit | Library |
|---|---|---|
| An answer with at least one route | 0 | returns the answer |
| An answer with no route | 3 | returns the answer |
| Invalid query, flags or subcommand | 2 | throws `RouterError`, `query-invalid` |
| `--describe` with `privacy: secret` | 2 | throws `RouterError`, `describe-private` |
| `--describe` with no `privacy`, or an empty description | 2 | throws `RouterError`, `query-invalid` |
| The registry cannot be loaded | 4 | rethrows `model-registry`'s `RegistryError` unchanged, with the path |
| `router`, `tasks` or `policy` invalid | 4 | throws `RouterError`, `registry-sections-invalid` |
| `config.json` invalid, or an explicit path missing | 4 | throws `RouterError`, `config-invalid` |
| Jev gave no answer and the task was needed | 5 | throws `RouterError`, `describe-failed` |
| Internal fault | 1 | throws |

- The CLI prints an answer on stdout, also at exit 3. It prints an error
  as `{"error": {...}}` on stderr. A loader error keeps
  `model-registry`'s code and message.
- `RouterError` carries `code`, `message`, `fix`, `field` and
  `problems[]`.
- A check against the query's shape or a fixed vocabulary is an error. A
  check against registry content is a warning. This is the standing
  rule that missing data is never a failure.
- When the hard limits remove every route, the answer is complete: it
  keeps the digest, the removed routes with reasons, and the warnings.
  The `privacy: secret` case keeps today's text, that the work runs
  locally or not at all, as a warning.

### `model-registry`

Source: [Define registry format version 1][t16], decisions 13, 14 and
16, with the two exits Kevin fixed on 2026-10-01.

`RegistryError` has `code`, `message`, `fix`, `path` and `problems[]`.
Each problem has `code`, `field`, `message` and `fix`. One run reports
every problem. The loader has errors only and no warnings channel.

| Code | Cause |
|---|---|
| `registry-missing` | no file at the resolved path |
| `registry-unreadable` | the file cannot be read or parsed |
| `format-missing` | no `format` field: not a version 1 registry |
| `format-unsupported` | a `format` higher than the loader knows, or an older major; the `fix` names `migrate` or an upgrade |
| `registry-invalid` | a shape error, an unknown field, or `null` |
| `label-duplicate` | two routes with the same label |
| `reference-unknown` | an undeclared rating, capability, meter or label in the format's own sections |
| `rating-mismatch` | a written rating that the stored table does not give and no override allows |

| Command | Outcome | Exit |
|---|---|---|
| `check` | the file loads; prints `{ "format", "digest", "path" }` | 0 |
| `check` | the loader fails; prints the error | 4 |
| `migrate` | the file is already current; prints "nothing to do" | 0 |
| `migrate` | migrated, validated and written | 0 |
| `migrate` | the migrated result is invalid; nothing replaced | 4 |
| `migrate` | `registry.json.format-<N>.bak` already exists; nothing written (`backup-exists`) | 2 |
| any | unknown command or flag (`usage-invalid`) | 2 |

Errors print as `{"error": {...}}` on stderr, as `model-router` prints
them.

### Availability codes

Source: [Define the router's configuration and availability input][t18],
decision 7.

| `availabilityNote` code | Cause |
|---|---|
| `availability-command-missing` | `--availability` given and no `availability.command` |
| `availability-command-failed` | not found, non-zero exit, or timeout (the command is killed); `message` says which |
| `availability-file-unreadable` | the `--availability-file` path cannot be read |
| `availability-reading-invalid` | not JSON, a wrong top level, or an unknown `format` |
| `availability-reading-stale` | `generatedAt` older than `maxAgeSeconds`, or in the future |

| Warning code | Cause | Raised by |
|---|---|---|
| `availability-exhausted-all` | exhaustion would remove every route, so none is removed | the function |
| `availability-entry-invalid` | an entry was skipped | the CLI's reader |
| `meter-undeclared` | an entry names a meter the registry does not declare | the engine |
| `meter-no-reading` | a reading was applied, and a meter that routes use has no entry | the engine |

A failed availability source MUST NOT fail routing. The CLI ranks
without availability, exits as it would otherwise, and fills
`availabilityNote` with a `fix`.

### Describe warnings

| Warning code | Cause |
|---|---|
| `task-uncertain` | Jev's task is below `taskGate`; the `fix` says to pass `task` |
| `capabilities-unasked` | Jev gave no answer when the task was not needed; the `fix` says to add any needed capability to `needs` |

### graybox codes

graybox uses `delegate`'s codes with the same meanings and adds
`route-not-admitted`, `owner-route-not-admitted` and
`owner-route-unavailable`. This is a convention. No package exports the
codes ([Specify how graybox uses the library][t11], decision 13).

## Security Considerations

### Private text and hosted models

- `privacy: secret` MUST keep only routes with `privacyEligible: true`.
  When none is left, the answer is empty, the CLI exits 3, and the
  warning says that the work runs locally or not at all.
- The describe step MUST refuse `privacy: secret` before any request
  (`describe-private`). With `--describe`, `privacy` has no default, so a
  caller that forgets it gets exit 2 and not a hosted call. Today's step
  sends the description to hosted Jev even for secret work. This RFC
  closes that gap.
- No scrubber is offered. A scanner finds credential shapes but not
  private prose, and a miss sends private text with a record that reads
  as a pass.
- `hosted` is REQUIRED on every route, because a wrong default either
  way is a privacy fault.
- The query is closed, so a misspelled `privacy` field cannot silently
  drop `secret`.

### Trust boundaries

- The registry file and `config.json` are trusted operator input. The
  loader validates their shape, but it cannot tell whether a fact is
  true.
- `availability.command` is an argv array, run with no shell, so quoting
  and shell expansion cannot change what runs. The command runs with the
  user's rights. Anyone who can write `config.json` can run a program as
  that user, and the same holds for any configuration that names a
  command.
- The availability document is untrusted data. A broken document only
  loses availability, and unknown fields are ignored.
- A wrong route string is found when the runner refuses it. The walk
  advances and records the refusal with a `fix`, so the bad entry stays
  visible.

### Credentials

- The Jev key comes only from `TYPESAFE_API_KEY`. `config.json` holds no
  key. Error messages name only the variable, never a credential tool or
  path.
- A missing key is reported only when the describe step needs Jev. A
  caller with a structured query needs no key.

### Private operator data in public repositories

Both repositories and both trackers become public. A public history
cannot be made private again.

- The packages MUST ship no personal registry data. The example registry
  uses placeholder names and placeholder figures.
- Before its first release, each repository's files and full git
  history MUST be audited for operator detail: registry values, route
  names or labels from the operator's registry, credential paths, and
  private tool or machine names. `model-router`'s code comes out of a
  private skills repository, so its first commits are the likeliest
  place for such detail.
- The skills repository runs a no-model-names check on each commit
  (see [Consumers](#consumers)).
- The operator's registry, the conversion script and the comparison
  table stay in the operator's existing private configuration sync and
  private task folders. Neither public repository holds them.

### Blast radius

- A broken registry stops every ranking call that uses it, with exit 4.
  graybox's list source is unaffected, and its router-source Tasks are
  refused with the loader's error. graybox never falls back to the list
  in the router's place.
- A bad `model-router` release reaches every skill on its next call,
  because skills resolve `@latest`. The undo for the skills is a revert
  and redeploy (see [Cutover](#cutover)). graybox meets a release only
  when it raises its pin.

## Versioning

Source: [Choose distribution and the release rule][t8], refined by
[Define contract version 1][t5], decision 16,
[Define registry format version 1][t16], decision 19, and
[Decide the cutover order for live consumers][t20], decisions 9 and 10.

### Below 1.0.0

Both packages start at 0.1.0. Below 1.0.0, a breaking change bumps the
minor and every other change bumps the patch. The rules below bind from
1.0.0. Both packages reach 1.0.0 at the same point: after graybox's
router source (rung 8) runs live. `model-registry` 1.0.0 goes first,
then `model-router` 1.0.0 with `model-registry` on `^1.0.0`.

### `model-registry`

`format` increases only when a valid file stops being valid or changes
meaning.

| Change | Release |
|---|---|
| A field becomes required, a field is removed or renamed, or a type or meaning changes | major, `format` + 1, with a migrate step |
| A loader result field is removed or changed, or a CLI command, flag or exit code changes | major, `format` unchanged |
| A new optional field or section, or a new effort level | minor |
| A new loader result field, or a new error or problem `code` | minor |
| The rating prompt changes the ratings it produces | minor |
| `message` or `fix` text, the example registry, or the rating prompt's wording | patch |

- Each major MUST ship the migration step from the previous major. The
  rule starts at format 2: version 1 is the first major, so no step
  leads to it.
- A package test migrates the previous major's example and validates the
  result.
- Release notes say whether the format changed.
- Known cost: the closed sections mean a file that uses a field added in
  a newer minor fails on an older loader.

### `model-router`

`contract` increases only on a query or answer break. A major for
another cause leaves it unchanged.

| Change | Release |
|---|---|
| An answer field is removed or renamed, or its type or meaning changes | major, `contract` + 1 |
| A query field becomes required, or a fixed query value is removed | major, `contract` + 1 |
| A new value in `placedBy`, `floor` or `availability` | major, `contract` + 1 |
| A break in the CLI commands, flags or exit codes, the library API, the config schema or the router sections' schema | major |
| A move to a new `model-registry` format major | major |
| A change to the availability document format (`format` + 1) | major |
| The same registry and query can rank differently | minor |
| The describe step's defaults change | minor |
| A new optional query field, a new accepted value for a fixed query field, or a new answer field | minor |
| A new optional `config.json` key | minor |
| A new error, warning or reason `code` | minor |
| A fix that changes no ranking | patch |
| `message` or `fix` text | patch |

Consumers branch on every value of `placedBy`, `floor` and
`availability`, so a new value there is a break. Codes are open.

The rows for the router sections' schema, the availability document
format and a new optional `config.json` key come from assumptions
recorded in [Define the router's registry sections][t17] and
[Define the router's configuration and availability input][t18]. They
apply the rule of [Choose distribution and the release rule][t8],
decision 7, to the schemas those tickets added.

### Dependencies and pins

- `model-router` depends on `model-registry` with a caret range on the
  major, as a regular dependency. A `model-registry` minor or patch
  reaches users without a `model-router` release.
- Skills MUST NOT pin a version. The CLI call resolves `@latest` on each
  call. Bundled imports are built at each deploy from the newest release
  in the major. A major release reaches the CLI before the next deploy
  reaches the bundles.
- graybox pins `model-router` at an exact version with
  `pnpm add --save-exact`. Its committed lockfile fixes both packages.
- When the skills meet a new format major, the next call fails with the
  loader's error until the user runs `model-registry migrate`. graybox
  meets it only when it raises its pin.

### Distribution

- Both packages publish to npm as `@dungle-scrubs/model-registry` and
  `@dungle-scrubs/model-router` with public access. Neither is
  distributed through Homebrew.
- Each repository goes public before its first npm release, after the
  audit in [Security Considerations](#security-considerations). npm
  does not support provenance for a private source repository.
- release-please cuts each release from conventional commits and writes
  the changelog. The publish job in the same workflow uses npm trusted
  publishing from a GitHub-hosted runner, with provenance (npm CLI
  11.5.1+, Node 22.14.0+).
- Each package name is created by hand once, with a 0.0.0 placeholder
  that holds only a README saying it is not released yet. 0.1.0 is the
  first release from GitHub Actions, so every version that contains
  code has provenance.

## Packages

### `@dungle-scrubs/model-registry`

| Export | Content |
|---|---|
| `loadRegistry({ path? })` | the loader's result; throws `RegistryError`. Synchronous. |
| the label builder | builds `<model key>@<harness>[/<provider>]` from a model key and a route |
| the effort ladder | `low < medium < high < xhigh < max` |
| `RegistryError` | the coded error |
| types | matching `registry.schema.json` |

Published files: `registry.schema.json`, one example registry with
placeholder names, and one optional agent prompt for filling ratings.
A package test validates the example against the schema and runs
`check` on it, so the example's placeholder table agrees with its
ratings.

No label parser ships.

```
model-registry check   [--registry <path>]
model-registry migrate [--registry <path>] [--dry-run]
```

- `check` runs the loader. The rating prompt's last step runs it.
- `migrate` finds the file by the loader's path order and applies each
  step in turn up to the current major. It validates the result with the
  same checks as `check` before it writes. It writes the backup
  `registry.json.format-<N>.bak` beside the file, then replaces the file.
  It refuses when that backup exists. `--dry-run` prints the migrated
  file on stdout and writes nothing.

#### The rating method

Source: [Specify the rating method][t15], which refines
[Decide how a user supplies registry data][t6], decision 6.

The package ships no code that produces ratings. It ships one agent
prompt, as documentation. The prompt tells an agent to:

1. Ask the user which ratings matter, which benchmarks feed each rating,
   and which models to rate. Artificial Analysis is the named example
   source.
2. When a benchmark has no table, or its published version differs from
   the version the table records, propose bands from the current
   figures, show the ratings those bands give, and write nothing until
   the user approves.
3. Read the figures and record each one with its date and effort level.
4. Write ratings by the table lookup, and write overrides with reasons.
5. Run `model-registry check`.

Jev has no part in rating. The package ships no default bands.

### `@dungle-scrubs/model-router`

| Kind | Exports |
|---|---|
| Ranking | `rank(query, { registry?, config?, availability? }): Answer`, synchronous and pure |
| Describe | `describe(text, partialQuery, { registry?, config? }): Promise<{ query, describe }>` |
| Read | `listTasks({ registry? }): TaskSummary[]` |
| Availability | `applyAvailability`, `dropExpired` |
| Jev client | `askJev`, `JevError`, and the types `JevQuestion`, `JevAnswer`, `JevResponse` |
| Errors | `RouterError` |
| Types | `Query`, `Answer`, `AnswerRoute`, `Coded`, `PinReport`, `DescribeBlock`, `TaskSummary`, `RouterConfig`, `AvailabilityEntry`, `AvailabilityDocument`, `AvailabilityResult`, `RankOptions`, `DescribeOptions` |
| Schema files | `query`, `answer`, `error`, `config`, `availability` and the router sections |

- `registry` takes a path or a result from `loadRegistry`. Absent, the
  loader's path order applies. A caller can load once and pass the same
  result to `listTasks` and `rank`, so the task list and the ranking come
  from the same bytes and the same digest.
- `config` takes a path or a settings object. An object is validated
  like a file.
- `rank`'s `availability` takes entries the caller has gathered. The
  caller runs `dropExpired`. Without it, metered routes are `unknown` and
  `availabilityNote` is `null`. `rank` takes the `spendToZero` meters
  from the registry.
- `listTasks` returns `[{ name, description }]` in file order, or `[]`
  with no `tasks` section. It validates the router's sections as `rank`
  does, so a caller never shows a model tasks that `rank` then refuses.
- The library does not re-export `model-registry`'s loader or label
  builder.
- The Jev client's key and retry helpers, the effort helpers and the
  engine's internal steps stay private.
- A package test validates the engine's answers against
  `answer.schema.json`. The query schema rejects undefined fields. The
  answer schema allows them.

```
model-router '<query>' | - [--registry <p>] [--config <p>] [--availability | --availability-file <p>] [--describe <f>]
model-router tasks [--registry <p>]
model-router check [--registry <p>] [--config <p>]
```

- A first argument that starts with `{` or `-` is the ranking call. Any
  other word MUST be `tasks` or `check`. An unknown word is exit 2 with a
  `fix` that lists the subcommands.
- The query is the positional JSON argument, or `-` to read stdin. No
  query argument is exit 2. There are no per-field flags.
- `--availability` runs `availability.command`. `--availability-file`
  reads a saved document. Both check `generatedAt` against
  `maxAgeSeconds` and apply `dropExpired`. Both together is exit 2.
  Without either, no availability is read.
- `--availability` with no configured command ranks without
  availability at exit 0 and fills `availabilityNote`.
- `--describe <file>` reads the description from the file, calls
  `describe` and then `rank`, and merges the describe block into the
  answer.
- `tasks` prints `listTasks` as JSON: exit 0 (also with `[]`), or exit 4.
- `check` loads the registry, validates the router's sections and
  `config.json`, and prints
  `{ "registryPath", "registryDigest", "configPath" }`. `configPath` is
  `null` when defaults apply. It exits 0 or 4. It runs no availability
  command and makes no Jev call.
- A flag that does not apply to a subcommand is exit 2.
- Today's `--runway`, `--runway-file`, `--tasks`, `--models` and
  `--matrix` get no alias.

### Where today's files go

Source: [Draw the package boundary][t3], with the later revisions
applied.

| File in `choose-model` today | Goes to |
|---|---|
| `choose.ts`: fact types, `loadRegistry`, fact validation | `model-registry` |
| `choose.ts`: query parsing, ranking, task and policy validation, the CLI | `model-router` (the matrix view is dropped) |
| `routing-query.ts`, without its pane questions | `model-router` (`describe`) |
| `jev.ts` | `model-router`, exported as `askJev` and `JevError` |
| `runway.ts`: reading the neutral format | `model-router` |
| `runway.ts`: the converter from the operator's quota tool | stays in the skills, private |
| `pane-questions.ts` | moves to `delegate`, its only remaining user |
| `rescore.ts` | retired ([Specify the rating method][t15]) |
| `fetch-figures.ts` | stays a private reading aid; imports `model-registry` only |
| `registry.json` | the operator's configuration, in neither repository |
| `REGISTRY.md` | the format description splits across the two packages' documentation; the calibration history stays private |
| tests | follow their source file |

## Consumers

### Skills

Source: [Specify how the skills move to the CLI][t10], with the CLI
names from [Define model-router's library API and CLI surface][t19].

| Consumer | Change |
|---|---|
| `choose-model` | `SKILL.md` keeps rules and pointers: when to query and when to skip; the fields a caller decides (`stakes`, `privacy`, `excludeFamilies`, `spec`, and `pin` only with `task` or `minimums`); the invocation and the quota converter step; what to do on exits 0, 2, 3, 4 and 5; acting on each `fix`; the work-description writing rules; stating `privacy` with `--describe`; acting on `task-uncertain`. It uses `model-router tasks` and drops `--models` and `--matrix`. Field types, defaults and answer fields are read from the package schemas, not copied into the skill. |
| `delegate` | Reads `routes` in place of `selection` and `fallbacks`, and `removed` in place of `excluded`. Omits `--effort` when a route has no `effort`. Applies the consumer walk rule. Reports per [`delegate`'s report](#delegates-report). `delegate.ts --choice <file>` never runs the router and never handles the CLI's exits. Five gate scripts import the Jev client, and `delegate.ts` imports the availability functions. |
| `jev-sweep` | Imports the Jev client. |
| `interrogate` | `panel.ts` runs the CLI in place of an in-process call. Its test uses the fixture registry. |
| `audit-skills` | Its pinned panel routes become pins in queries that carry a `task`. |
| Operator's registry refresh | Imports `model-registry` only (loader and label builder). Its routing diff runs the CLI with `--registry <old>` and `--registry <new>`. It runs `delegate`'s consistency script after each refresh. |

- **Bundling.** The skills repository declares
  `@dungle-scrubs/model-router` with a caret range on the major, so its
  tests run against it. The deploy step bundles each importing script
  into a self-contained `.mjs` with the router code inlined, from the
  newest release in the major. Those scripts run as `node <script>.mjs`.
  Nothing is installed beside the deployed skills.
- **Fixtures.** Skill tests run on fixtures committed in the skills
  repository. `delegate`'s tests use answer files validated against
  `answer.schema.json`. `interrogate`'s test runs the CLI with
  `--registry` on a fixture registry with placeholder names. No skill
  test reads the operator's registry. The published example registry is
  not used as the fixture, because a patch may change it.
- **No-model-names check.** A script in the skills repository, run by
  the pre-commit hook on each commit that touches a skill and by the
  test command, scans every text file under the skills tree. Every
  route label, model key and `modelId` in the operator's registry counts
  as a model name. A match fails the check, unless it is the `pin` of a
  query that also carries `task` or `minimums`. On a machine with no
  registry file the script prints that it skipped and exits 0.
- **Consistency script.** `delegate`'s registry consistency tests become
  one script with two callers: the pre-commit check and the registry
  refresh. It holds `delegate`'s list of harnesses that accept
  `--skills` against the `skills` capability on each route. It skips
  with a notice when no registry file exists.

### graybox

Source: [Decide whether graybox runs without the router][t12] and
[Specify how graybox uses the library][t11].

- **One interface, two sources.** In: the work need, the admitted
  routes and graybox's availability entries. Out: the admitted routes
  in order, each with its identity, meter, availability and reason, plus
  the source identity. The Owner-named rule, the admitted-route check
  and the walk act on that output and do not know which source produced
  it.
- **List source** (the default). It uses the written order only and
  ignores the work need. It applies availability through
  `applyAvailability`. graybox holds no facts about models.
- **Router source.** The Primary picks a task from the names and
  descriptions that `listTasks` returns, and emits `task=<name>` with
  the Task directive. `routing.defaultNeed` applies when it emits none.
  graybox calls `loadRegistry`, `listTasks` and `rank` with one loaded
  registry, and keeps the ranked routes that match an admitted entry on
  `harness` + `modelId` + `provider`. graybox does not use the describe
  step.
- **Owner-named routes.** The Primary emits a route label only when the
  Owner named a model. The Primary's prompt describes no models; graybox
  puts the admitted labels in it. An Owner-named route skips the router
  on both sources. graybox checks it against the admitted list and the
  availability function only. It is never walked past. When it cannot
  run, graybox refuses with `owner-route-not-admitted` or
  `owner-route-unavailable`.
- **Loading.** graybox loads the registry for each routing decision and
  once at start. An edit applies to the next Task without a restart. The
  start check shows a broken file in the application interface at once.
  It does not stop graybox: list-source Tasks run, and each
  router-source Task is refused when its load fails. graybox never uses
  the list in the router's place.
- **Availability.** graybox reads no quota source. Its entries are its
  own record: `exhausted` entries from the runner's usage or quota
  failures, expired at the reset time with `dropExpired`. It never
  produces `projected` and passes no `spendToZero` list.
- **Effort.** The entry's `effort` wins when written. Otherwise the
  router's `effort` applies. With neither, graybox omits the effort
  flag. When the entry overrides the router, the decision record keeps
  the router's level.
- **No admitted route.** When no admitted route is available, graybox
  refuses the Task before launch and names each route and its reason.
  This covers an empty `routes` list, an answer with no admitted route,
  and every admitted route `exhausted`.
- **Routing decisions.** Each Task holds a list of routing decisions,
  and each attempt references one. A decision holds the source and its
  identity, the chooser (`owner` or `source`), the need as applied
  (router source), the ordered routes received (graybox's label, the
  registry label, availability, reason), and the walk's advances (label,
  failure class, code, the runner's message, `fix`). A route switch, or a
  resume that routes again, adds a decision and never overwrites one.
- **Source identity.** A router-source decision records `routerVersion`
  and `registryDigest`. A list-source decision records `sha256:<hex>`
  over the canonical JSON of `routing.routes` with keys sorted.
- **Setup.** With no `routing.primary` or no `routing.routes`, graybox
  starts, and the application interface shows a setup message naming the
  file and the missing key. No Primary turn and no Task runs until the
  key exists. graybox's documentation ships an example `routing`
  section with placeholder entries. There are no built-in default
  routes.
- **No model names in source.** The environment variable that selects
  the Primary's route, the built-in Primary default, the route constants,
  the admission records, the provider relays, the isolated-project types
  that allow one model, and the web UI selectors all read the configured
  entries. No model name remains in graybox source outside tests.
- **Dependency.** `model-router` is a regular dependency at an exact
  version, loaded only when the source is the router.

#### Changes to graybox's model-routing plan

| Rung | Change |
|---|---|
| 5 | **Routes in configuration** on the list source. Routes, the Primary's route and admission move to `routing`; the Primary emits a label only for an Owner-named model; availability uses the rule of `applyAvailability`. Until `model-router` publishes the export, rung 5 carries a temporary local copy of the rule, which MUST match [Availability rule](#availability-rule). Acceptance: with one meter `exhausted`, a Task with no model named starts on the next available list entry; the same Task with the exhausted route named by the Owner is refused with `owner-route-unavailable`; no model name remains in graybox source outside tests. |
| 6 | **Fallback** follows the consumer walk rule on the list source. An unavailable failure adds an `exhausted` entry on the route's meter. Each advance is recorded with its code and `fix`. Acceptance: the current acceptance, plus each advance visible in the record. |
| 7 | **Wayfinder end to end**, unchanged; it runs on the list source. |
| 8 (new) | **Router source.** The Primary picks a task, graybox filters the answer to admitted entries, and each decision records `routerVersion` and `registryDigest`. A broken registry refuses router-source Tasks and shows the start-check message. Acceptance: a fixture registry with placeholder names ranks two admitted routes, and an edit to it changes the recorded digest on the next Task without a restart. |

The plan's open question on fallback order is answered: the source's
order, and a fallback may cross harnesses.

## Cutover

Source: [Decide the cutover order for live consumers][t20].

### The order

| Step | What happens | Waits for |
|---|---|---|
| A | graybox rung 5 on the list source, with the temporary availability rule | nothing |
| B | `model-registry` audited, public, 0.1.0 | its implementation |
| C | `model-router` audited, public, 0.1.0 | B |
| D | graybox switches to the exported availability functions and drops its copy | C |
| E | conversion script written; converted registry and `config.json` pass both checks | B, C |
| F | skills step 1: bundler and Jev client imports | C |
| G | ranking comparison accepted; conversion rerun | E |
| H | rehearsed undo, then the ranking switch deployed | F, G |
| I | graybox rung 8 proved live | C, E |
| J | `model-registry` 1.0.0, then `model-router` 1.0.0 | H, I |

graybox rungs 6 and 7 run on the list source at any point after A.
Until step H, the skills run today's `choose.ts` and `delegate` on the
old file.

### Steps in detail

- **Audit and release (B, C).** Both repositories start private. Each
  goes public only after the audit in
  [Security Considerations](#security-considerations). Releases go in
  dependency order, with the placeholder and trusted-publishing steps of
  [Versioning](#versioning).
- **Conversion (E, G).** The converted registry and the old file exist
  side by side. A repeatable script reads the old file and writes format
  1 to the loader's XDG path. It adds what format 1 and the router's
  sections need: bands, overrides with reasons, task `rank` lists,
  floors in place of facets, the `requires` and `reasoning` renames,
  policy names, and the `router` section with `rank` and the two
  capability questions written into code today. The script proposes
  these additions and the operator approves them. Registry edits go into
  the old file only. The script runs a last time just before the switch,
  and `model-registry check` and `model-router check` validate its
  output. The script and its output hold operator data, so they live
  outside both repositories. No package ships the script.
- **Ranking comparison (G).** Every task in the operator's registry, at
  every stakes level, runs through today's engine on the old file and
  through the new CLI on the converted file. A table puts the two route
  orders side by side and marks each difference. The switch waits until
  the operator accepts every difference, or until the conversion script
  is fixed and rerun.
- **Skills step 1 (F).** The deploy step gains the bundler. Every skill
  script that imports the Jev client moves to `askJev` and `JevError`
  from `@dungle-scrubs/model-router`. This step touches no ranking and
  no registry data.
- **Skills step 2, the ranking switch (H), as one commit and one
  deploy.** `choose-model`'s `SKILL.md` moves to the CLI and to
  `model-router tasks`. `delegate` reads `routes` and imports the
  availability function. `interrogate` runs the CLI. `audit-skills`
  turns its pinned routes into pins with a `task`. The quota converter
  prints `format: 1` with meter names the registry declares. Callers
  move from `--runway` to `--availability`. The operator's
  `config.json` names the converter in `availability.command`.
  `choose.ts`, the modules that move to `model-router`, and the old
  registry file leave the skills repository. These changes cannot be
  split: `delegate` reads the old answer's `selection` and `fallbacks`,
  and the old engine reads the old converter's output.
- **graybox (A, D, I).** graybox moves on its own track. Rung 5 needs no
  package. Once `model-router` 0.1.0 is published, the graybox commit
  that imports `applyAvailability` and `dropExpired` at an exact version
  removes the local copy. Rung 8 needs the converted registry and a
  `model-router` release.
- **1.0.0 (J).** Rung 8 is the first live library call of `loadRegistry`,
  `listTasks` and `rank`. The API freezes only after its library
  consumer has used it.

### Rollback

- **Ranking switch (H).** The undo is a revert of the switch commit and
  a redeploy. The revert brings back `choose.ts`, the old registry file
  and the old converter. The converted file can stay, because the old
  engine never reads it. Before the live deploy, on a branch, the switch
  MUST be deployed to a scratch deploy target, one ranking run, the
  commit reverted and deployed to the same target, and today's engine
  confirmed to answer from the old file. An undo that was never run is
  not proven to work.
- **Skills step 1 (F).** A revert of that commit and a redeploy. It is a
  separate commit so that a bundler fault and a ranking fault never
  arrive together.
- **graybox.** graybox's committed lockfile keeps it on a known package
  version. It meets a new release only when it raises its pin.

## Implementation Notes

### Measurements behind the decisions

| Fact | Figure | Source |
|---|---|---|
| Chosen `npx` invocation, warm cache | about 450 ms per call; an installed binary about 87 ms | [Choose distribution and the release rule][t8] |
| Read, parse and SHA-256 of an operator-sized registry | under 1 ms | [Specify how graybox uses the library][t11] |
| Today's describe step: task accuracy | 84%; 72% of rows at or above the 0.85 gate, all but three correct | [Specify the describe step's contract][t14] |
| Today's `stakes` question accuracy | 58% | [Specify the describe step's contract][t14] |
| Source that becomes `model-router` | four files, 2,177 lines, no third-party imports | [Decide whether graybox runs without the router][t12] |
| HCN's refusal of its own input | exit 2, class `rejected`, not retryable, before the harness starts | [Decide whether the router contract assumes HCN][t13] |

### Assumptions carried from the tickets

- The chosen `npx` invocation needs the npm registry to be reachable on
  every call. Offline behavior was not tested.
- npm needs a package name to exist before a trusted publisher can be
  configured. If it does not, the 0.0.0 placeholder is not needed.
- The runner's event stream shows a tool call or model output before a
  failure whenever work was done. A harness that changes files without
  emitting either defeats the work-seen check.
- Ratings are integers, and ratings stay per model: every route of a
  model inherits them. Route-level facts are cost and response time.
  Response time is a figure copied as read, not a banded rating.
- A model's figures are read at one effort level, the level the user's
  routes run at.
- The skills repository's deploy step can run a bundler and deploy to a
  scratch target.

### Left to implementation

The tickets name these as implementation: the internal module layout,
the bundler, help text, the schema file layout, the TypeScript type
names beyond the export list, the rating prompt's wording and file name,
the conversion script, the comparison table's layout, the audit tooling,
the Codex sandbox field name and the `access` values in graybox, and the
consumers' exact report field names beyond those this RFC lists.
`--help` and `--version` print and exit 0, and are not part of the
contract.

The implementation also names the warning and reason codes that no
ticket named, and the label builder and ladder exports (Kevin,
2026-10-01). Each package's documentation MUST list every code it can
emit. The unnamed codes are: the unknown-task, unknown-need,
unknown-rating and unknown-family warnings; the effort-lowered warning;
the no-matching-policy warning; the policy-route-removed warning; the
hard-limit removal reasons; the floor reasons; and the pin-not-used
reasons.

## Alternatives Considered

Each line names the decision that rejected the alternative.

| Alternative | Why it was rejected | Ticket |
|---|---|---|
| One package holding the engine in this repository | A storage-only package lets anyone validate a file without the engine; the chooser is one shared package | [Draw the package boundary][t3] |
| The engine reads quota itself | The engine must be pure and testable; the quota tool is the operator's own | [Decide how availability and quota reach the engine][t4] |
| An HCN adapter or a check against HCN | The router would track HCN releases; the shared part is four flags; HCN refuses bad input before any work | [Decide whether the router contract assumes HCN][t13] |
| An exported walk function or outcome table | The shared part is a few lines; reading the runner's failure is runner-specific | [Decide where the fallback walk lives][t9] |
| Unknown task ranked cheapest first, or an error | A misspelled task would go to the cheapest route; missing data is never a failure | [Define contract version 1][t5] |
| A `toHcn` or HCN-shaped contract | A user without HCN could not add a harness | [Decide whether the router contract assumes HCN][t13] |
| JSONC, YAML or TOML for the registry | Programs rewrite the file; plain JSON needs no parser and has a simple digest | [Decide how a user supplies registry data][t6] |
| Ranking models against each other for ratings | Adding a model would move the ratings of unchanged models | [Specify the rating method][t15] |
| A `harnesses` section | Its upkeep exceeds its use; harness stays a plain string | [Define registry format version 1][t16] |
| A migration step from today's format | It would carry one private registry's quirks in the package | [Define registry format version 1][t16] |
| Two policy kinds (`preferred`, `settledSpec`) | Two shapes and two rule sets for one behavior | [Define the router's registry sections][t17] |
| A describe-only subcommand, or `describe` as an option on `rank` | A second call and error surface; `rank` would become async | [Specify the describe step's contract][t14], [Define model-router's library API and CLI surface][t19] |
| A scrubber for private text | A miss sends private text with a record that reads as a pass | [Specify the describe step's contract][t14] |
| `models` and `matrix` read views | A second public format for the same facts; one user | [Define model-router's library API and CLI surface][t19] |
| A global install for the skills | Each machine would stay on the version last installed | [Choose distribution and the release rule][t8] |
| Committed bundles, or `node_modules` beside the deployed skills | Bundles go stale; the agent directory holds only entries the operator places | [Specify how the skills move to the CLI][t10] |
| graybox auto-detecting the router | A registry file outside graybox's configuration would change graybox's routing | [Decide whether graybox runs without the router][t12] |
| graybox's Primary picking a route as a pin | The prompt would have to describe models; only the registry qualifies models | [Specify how graybox uses the library][t11] |
| Built-in default routes in graybox | They put model names back in code | [Specify how graybox uses the library][t11] |
| Creating `model-router` public from its first commit | Its first commits come from a private repository; a public history cannot be made private again | [Decide the cutover order for live consumers][t20] |
| 1.0.0 at graybox rung 5 | A problem found at rung 8 would cost a major | [Decide the cutover order for live consumers][t20] |

## Open Questions

None is open. The eight gaps found while drafting were decided by Kevin
on 2026-10-01 and are listed in
[Where the decisions come from](#where-the-decisions-come-from).

## References between sections

`model-registry` MUST validate every reference inside its own sections:
a route's `meter`, rating and capability names, `feeds`, `handSet` and
`overrides`. An unknown reference is `reference-unknown`. `model-router`
validates the labels and names that `router`, `tasks` and `policy` use.

#### The loader's result

```ts
loadRegistry({ path?: string }) -> {
  path:     string,          // the resolved path
  digest:   "sha256:<hex>",  // of the file bytes as read
  format:   1,
  registry: { ratings, capabilities, meters, models, calibration },
  routes:   { "<label>": { model: "<model key>", ...route facts } },
  sections: { "<name>": <untouched> }
}
```

- The loader MUST hash the whole file as read. Reformatting the file, or
  editing `calibration`, changes the digest although routing does not
  change. That cost is accepted: `tasks` and `policy` change routing as
  well as the facts, and anyone can reproduce the digest with a standard
  checksum tool.
- `routes` is the index by label. A consumer reads registry facts there,
  because the router's answer does not copy them.
- `sections` holds `router`, `tasks`, `policy` and any other section the
  format does not define.
- On failure the loader throws one `RegistryError` that lists every
  problem (see [Error Handling](#error-handling)).

### Router sections of the registry file

Owner: `model-router`. Source: [Define the router's registry sections][t17].

```json
"router": {
  "rank": ["intelligence", "taste"],
  "questions": { "browser": "Does the work require driving a web browser?" }
},
"tasks": {
  "implement": {
    "description": "Write or change code to a stated spec.",
    "minimums": {
      "low":    { "coding": 6, "taste": 3 },
      "normal": { "coding": 7, "taste": 5 },
      "high":   { "coding": 8, "taste": 6 }
    },
    "rank": ["coding", "taste"],
    "needs": ["repo-access"],
    "effort": "high"
  }
},
"policy": {
  "explore-first": {
    "task": "explore", "stakes": ["normal", "high"],
    "routes": [ { "route": "model-a@harness-x", "effort": "medium" } ],
    "reason": "Fast enough for code navigation.", "since": "2026-09-30"
  },
  "settled-implement": {
    "task": "implement", "stakes": ["low", "normal"], "spec": "settled",
    "routes": [ { "route": "model-b@harness-y" }, { "route": "model-c@harness-y", "effort": "high" } ],
    "reason": "Settled specs go off the expensive routes."
  }
}
```

#### `router`

- `router` with a non-empty `rank` is REQUIRED. A file without
  `router.rank` fails with `registry-sections-invalid`, and the `fix`
  shows the line to add.
- `router.rank` is an ordered list of rating names. It orders routes
  when the query has no known task: an unknown task, or inline
  `minimums` alone.
- `router.questions` is OPTIONAL. It maps a declared capability name to
  a yes/no question sentence that the describe step asks.

#### `tasks`

| Field | Required | Absent means |
|---|---|---|
| `description` | yes, one line | - |
| `minimums` | yes, with all of `low`, `normal` and `high` | - |
| `rank` | yes, not empty | - |
| `needs` | no | no required capability |
| `effort` | no | the `config.json` default |

- `minimums.<stakes>` names ratings from the `ratings` section. Today's
  `facet`, and its fallback to intelligence, are dropped. A coding task
  floors `coding`.
- `rank` is an ordered list of rating names that orders routes (see
  [Sort order](#sort-order)).
- The field names match the query: today's `requires` becomes `needs`,
  and `reasoning` becomes `effort`.
- graybox's Primary and the describe step both choose a task by its
  `description`.
- `tasks` is OPTIONAL. Absent means no tasks. A named task then gets the
  unknown-task warning.

#### `policy`

- Each policy is a named entry with `task`, `stakes` (a list of stakes
  levels), `routes`, a REQUIRED `reason`, an OPTIONAL `since`, and an
  OPTIONAL `spec`.
- Each policy route has `route` (a label) and an OPTIONAL `effort`.
- A policy without `spec` applies whatever the query's `spec` is. A
  policy with `"spec": "settled"` applies only to a `spec: settled`
  query. `spec: settled` triggers nothing else.
- At most one policy applies to a query. A policy with `spec` beats one
  without. Two policies that could match the same query at the same
  level (the same task, an overlapping stakes level, the same `spec`
  condition) MUST make the file invalid.
- A policy `effort` above the model's `maxEffort`, or different from its
  `fixedEffort`, MUST make the file invalid.
- `policy` is OPTIONAL. Absent means no policy applies.

#### Validation

Every problem in `router`, `tasks` and `policy` MUST be an error,
`registry-sections-invalid`, with one problem per finding in the shape
of `model-registry`'s `problems[]`. The sections are closed: an unknown
field is an error. The errors cover a wrong shape; a rating, capability,
task or route label that the file does not declare; an effort level not
on the ladder; a policy effort against the model's limits; and two
policies that tie. Known cost: removing a route from routing also needs
an edit to every policy that names it.

### Query

Owner: `model-router`, contract version 1. Source:
[Define contract version 1][t5], decisions 2 to 10.

| Field | Type | Required | Default | When the value is not in the registry |
|---|---|---|---|---|
| `task` | string | `task` or `minimums` | none | ranked by `router.rank`, warning |
| `minimums` | object, rating name to number | `task` or `minimums` | none | every route counts as below that floor, warning |
| `needs` | list of strings | no | `[]` | every route lacking it is removed, warning |
| `effort` | string | no | the task's level, else the `config.json` default | above the ceiling: lowered, warning; not on the ladder: ignored, the default used, warning |
| `pin` | route label | no; needs `task` or `minimums` | none | the pin is not used, with a reason |
| `stakes` | `low`, `normal`, `high` | no | `normal` | selects the task's floor set; no effect on an inline-only need |
| `prefer` | `cost`, `speed` | no | `cost` | - |
| `privacy` | `normal`, `secret` | no | `normal` (none with `--describe`) | - |
| `excludeFamilies` | list of strings | no | `[]` | an unknown family excludes nothing, warning |
| `spec` | `open`, `settled` | no | `open` | no matching policy: normal ranking, warning |

- A query MUST carry `task`, or `minimums`, or both. `"minimums": {}`
  states "no floor" explicitly. A query with neither is `query-invalid`.
- A `pin` without `task` or `minimums` is `query-invalid`.
- A field the contract does not define MUST be `query-invalid`. Input is
  strict, so a misspelled `privacy` cannot silently drop `secret`.
- Task plus inline fields: `minimums` replaces the task's floor for each
  rating it names, at the query's stakes. `needs` adds to the task's
  needs. `effort` replaces the task's level.
- With `--describe` (or the library's `describe`), the partial query
  MUST state `privacy`. The default does not apply there.

### Answer

Owner: `model-router`, contract version 1. Source:
[Define contract version 1][t5], decisions 11 and 12, with the
`describe` field from [Specify the describe step's contract][t14].

| Field | Content |
|---|---|
| `contract` | `1` |
| `routerVersion` | the `model-router` package version |
| `registryDigest` | `sha256:<hex>`, the loader's `digest` |
| `query` | the query as applied, with defaults and describe-filled fields |
| `pin` | `null` without a pin; else `{ label, used, reason }` |
| `routes` | one ordered list of routes, possibly empty |
| `removed` | each route removed by a hard limit or by `exhausted`: `{ label, reason }` |
| `warnings` | a list of coded objects |
| `availabilityNote` | a coded object saying why availability was not applied, or `null` |
| `describe` | the describe block, or `null` without `--describe` |

`routerVersion` and `registryDigest` together are the source identity a
consumer records.

#### Answer route

Each route carries four groups of fields and nothing else:

| Group | Fields |
|---|---|
| Identity | `label`, `model` (the model key), `harness`, `modelId`, `provider` (MAY be absent) |
| How to run it | `effort` (MAY be absent when no level is known) |
| Facts to run it safely | `hosted`, `family`, `meter` (MAY be absent) |
| Placement | `placedBy` (`pin`, `policy` with the policy name, or `rank`), `floor` (`clears`, `below` or `skipped`), `availability`, `reasons` (coded objects) |

Other registry facts (cost, ratings, capabilities, notes, rate limit,
response time) are not copied. A consumer reads them from
`model-registry`'s `routes` index by label. When `effort` or `provider`
is absent, a consumer MUST omit the matching runner flag.

`availability` takes one of five values (see
[Availability rule](#availability-rule)): `ok`, `projected`,
`exhausted`, `unknown`, `unmetered`.

#### Describe block

| Field | Content |
|---|---|
| `model` | the Jev model that answered, or `null` when Jev failed |
| `taskGate`, `capabilityThreshold` | the values applied |
| `task` | `source` (`caller`, `jev`, or `inline-need` when `minimums` was given), `confidence`, and `candidates`: the top choices with probabilities |
| `needsAdded` | each added capability with its probability |
| `usage` | Jev's token counts, or `null` |

The describe step's warnings go in the answer's `warnings` list.

### Router configuration: `config.json`

Owner: `model-router`. Source:
[Define the router's configuration and availability input][t18], with
the `describe` group from [Specify the describe step's contract][t14].

```json
{
  "$schema": "https://example.invalid/config.schema.json",
  "effort":       { "ceiling": "xhigh", "default": "medium" },
  "availability": { "command": ["availability-to-neutral", "--json"], "timeoutSeconds": 10, "maxAgeSeconds": 300 },
  "describe":     { "taskGate": 0.85, "capabilityThreshold": 0.5, "jevModel": "<the package's pinned Jev model>" }
}
```

| Key | Default | Rule |
|---|---|---|
| `effort.ceiling` | `xhigh` | a ladder level |
| `effort.default` | `medium` | a ladder level, not above `effort.ceiling` |
| `availability.command` | none | an argv array, run with no shell |
| `availability.timeoutSeconds` | `10` | a positive number |
| `availability.maxAgeSeconds` | `300` | the staleness bound, for command output and for a file |
| `describe.taskGate` | `0.85` | a probability |
| `describe.capabilityThreshold` | `0.5` | a probability |
| `describe.jevModel` | the Jev model the package pins | a Jev model name |

- Path order: `--config <path>` or the library's `config` option, then
  `MODEL_ROUTER_CONFIG`, then `$XDG_CONFIG_HOME/model-router/config.json`.
- When no file is at the XDG path, every default applies and no warning
  is added. An explicit path that does not exist, or an invalid file,
  MUST be `config-invalid`.
- Every key is OPTIONAL. The schema is closed: an unknown key is
  `config-invalid`. `$schema` is allowed for editor support.
- A default above the ceiling MUST be `config-invalid`. The file is
  validated against the ladder without loading the registry.
- The file holds no registry path and no Jev key. The key comes from the
  `TYPESAFE_API_KEY` environment variable.
- A user who needs a pipe in the availability command names a script.

### Availability document

Owner: `model-router`. Source:
[Decide how availability and quota reach the engine][t4], refined by
[Define the router's configuration and availability input][t18].

```json
{
  "format": 1,
  "generatedAt": "2026-10-01T04:00:00Z",
  "entries": [
    { "meter": "plan-a", "status": "projected", "resetsAt": "2026-10-01T09:00:00Z", "percentRemaining": 12, "note": "weekly window" },
    { "meter": "key-b", "status": "exhausted" }
  ]
}
```

- `format`, `generatedAt` and `entries` are REQUIRED. Each entry needs
  `meter` and `status` (`exhausted`, `projected` or `ok`). `resetsAt`,
  `percentRemaining` and `note` are OPTIONAL.
- Unknown fields are ignored.
- A broken document MUST NOT fail routing. A wrong top level (not JSON,
  no `generatedAt`, no `entries` array, an unknown `format`) means the
  CLI ranks without availability and fills `availabilityNote`. A single
  bad entry is skipped with a warning. The other entries still apply.
- An entry with an unknown status changes nothing.
- Several entries on one meter: the worst status decides, then the
  lowest `percentRemaining`.
- The package never names a quota tool. A user converts their own
  source into this document. The operator's converter from the
  operator's quota tool stays private.

### Consumer formats

These formats belong to the consumers, not to the packages. They are in
this RFC because the consumers share the codes by convention.

#### `delegate`'s report

Source: [Specify how the skills move to the CLI][t10], decision 10.

Each entry in `attempts` gains `workSeen` (boolean), `code` and `fix`.
The field `route` keeps the route label.

| `code` | When | `outcome` |
|---|---|---|
| `route-refused` | class `rejected` | `advanced` |
| `route-failed-before-work` | class `native`, no work seen | `advanced` |
| `route-unavailable` | a `retryable: true` class, no work seen | `advanced` |
| `failed-after-work` | `native` or a retryable class, work seen; the report carries `sessionId` | `stopped` |
| `work-verdict` | class `task` or `budget` | `stopped` |

A new `status`, `no-route`, covers an answer whose `routes` list is
empty. `delegate` runs nothing and copies the answer's `removed` and
`warnings` into the report. `intended` is `routes[0].label`, or `null`.

#### graybox's `routing` section

Source: [Specify how graybox uses the library][t11].

```json
{
  "routing": {
    "source": "router",
    "defaultNeed": { "task": "general" },
    "primary": { "harness": "harness-a", "modelId": "model-p", "effort": "high" },
    "routes": [
      { "harness": "harness-a", "modelId": "model-x", "provider": "provider-1", "meter": "provider-1-plan" },
      { "harness": "harness-a", "modelId": "model-y", "effort": "medium", "evidence": "Qualified on a fixture Task." },
      { "harness": "harness-b", "modelId": "model-x", "sandbox": "full", "access": "host" }
    ]
  }
}
```

- The section lives in graybox's existing XDG `config.json`.
- `source` is `list` or `router`. Absent means `list`.
- `primary` is one fixed route for the Primary. It is never ranked or
  walked.
- `routes` are the admitted Worker routes in written order. Listing a
  route admits it.
- `registry` is an OPTIONAL explicit registry path. Without it, the
  loader's path order applies.
- `defaultNeed` is the need used under the router source when the
  Primary states none.
- An entry uses the contract's route fields (`harness`, `modelId`,
  optional `provider`, optional `effort`, optional `meter`), plus
  graybox-only fields: the Codex sandbox, access limits and `evidence`.
  A provider is a separate field, never part of `modelId`.
- graybox's label is `<modelId>@<harness>[/<provider>]`, built from the
  entry, on both sources. Under the router source graybox also stores
  the registry label from the answer.

## State Machine

### Loading

```
START -> RESOLVE_PATH -> READ -> CHECK_FORMAT -> VALIDATE -> LOADED
READ          -> FAIL (registry-missing | registry-unreadable)
CHECK_FORMAT  -> FAIL (format-missing | format-unsupported)
VALIDATE      -> FAIL (registry-invalid | label-duplicate | reference-unknown | rating-mismatch)
```

`VALIDATE` collects every problem before it fails. `model-router` then
validates `router`, `tasks` and `policy` and loads `config.json` before
it ranks. A failure there is `registry-sections-invalid` or
`config-invalid`.

### Ranking

`rank` is synchronous and pure over its inputs. It MUST NOT read the
clock, run a subprocess or make a network call. The same registry,
configuration, query and availability entries MUST give the same
answer. Sources: [Define contract version 1][t5],
[Define the router's registry sections][t17],
[Define the router's configuration and availability input][t18]. The
steps run in this order:

1. **Validate the query.** A shape or vocabulary error throws
   `query-invalid`.
2. **Resolve the need.** Take the task's floors at the query's stakes,
   its `rank`, `needs` and `effort`. Apply the inline fields over them.
   An unknown task adds a warning. With no known task, the order list is
   `router.rank`.
3. **Apply the hard limits.** Remove every route that fails one, with a
   reason:
   - `privacy: secret`: a route without `privacyEligible: true`.
   - `excludeFamilies`: a route whose model's family is listed.
   - `needs`: a route that does not list every needed capability.
4. **Place the pin.** The pin is used when the label exists and the
   route passed the hard limits. A used pin goes first, with
   `placedBy: pin` and `floor: skipped`, and the fallback ranking
   follows without it. Otherwise the answer is the fallback ranking
   alone, `pin.used` is `false`, and `pin.reason` names the cause: an
   unknown label, a named hard limit, or `exhausted` (step 8).
5. **Place the policy.** At most one policy applies. Its routes follow
   the pin in written order, with `placedBy: policy` and
   `floor: skipped`. A policy route that a hard limit removed is in
   `removed`, and a warning names the policy. No route appears twice.
6. **Sort the rest.** See [Sort order](#sort-order) below.
7. **Resolve effort** for each route. See [Effort](#effort).
8. **Apply availability.** Call the availability rule on the full
   ordered list, after the pin and the policy have placed their routes.
   Availability applies to a pin or policy route as to any route: an
   `exhausted` pin is removed and reported as not used, and a
   `projected` one moves below the healthy routes.
9. **Build the answer.** An empty `routes` list is an answer, not an
   error.

#### Sort order

Within the routes that step 6 sorts, routes that clear every floor come
first and routes `below` a floor come after them. A model with no value
for a floor's rating counts as below that floor. This sort order is
normative (Kevin, 2026-10-01; it was an assumption in
[Define the router's registry sections][t17]):

- **Clearing routes, `prefer: cost`:** cost (higher rating, so cheaper,
  first), then the `rank` ratings in turn, highest first, then the
  model's route order.
- **Clearing routes, `prefer: speed`:** response time first, then the
  same order as `prefer: cost`.
- **Routes below a floor:** the `rank` ratings in turn, then cost, then
  route order.
- A route whose model lacks a `rank` rating sorts below every route that
  has it. A route with no `cost`, or with no `responseSeconds` under
  `prefer: speed`, sorts below every route that has it (Kevin,
  2026-10-01).
- The last tie-break is file order.

Example: task `implement` with `rank: ["coding", "taste"]` at normal
stakes keeps routes with `coding >= 7` and `taste >= 5` as clearing and
orders them cheapest first, then by `coding`, then by `taste`. A query
for the misspelled task `implemnt` orders every route that passed the
hard limits by `router.rank` and adds the unknown-task warning.

An unknown task ranks most capable first, never cheapest first, because
a misspelled task would otherwise send work to the cheapest route.

#### Effort

Sources: [Define contract version 1][t5], decision 9;
[Define the router's registry sections][t17], decision 9. Kevin fixed
the reading of "the default" on 2026-10-01: it is whatever level was
requested.

1. The requested level is the policy route's `effort` when stated, else
   the query's `effort`, else the task's `effort`, else
   `effort.default`.
2. A model's `fixedEffort` replaces the requested level.
3. A model's `maxEffort` caps the level. A lowered level adds a
   warning.
4. `effort.ceiling` caps every level last, including a level named by a
   task, a pin, a policy or a query. A lowered level adds a warning. It
   is never an error.
5. The router never emits `max` under the default ceiling.
6. A route MAY carry no `effort` when no level is known.

### Availability rule

`applyAvailability` is the one definition of the rule. The engine calls
it in step 8. `delegate` and graybox call it in their walks. graybox's
list source calls it with no registry. Sources:
[Decide how availability and quota reach the engine][t4],
[Define the router's configuration and availability input][t18].

```ts
applyAvailability<R extends { label: string; meter?: string }>(
  routes: readonly R[],
  entries: readonly AvailabilityEntry[],
  options?: { spendToZero?: readonly string[] },
): AvailabilityResult<R>          // { routes, removed, warnings }

dropExpired(entries: readonly AvailabilityEntry[], now: Date): AvailabilityEntry[]
```

- The function reads only `label` and `meter`. It returns the caller's
  own objects in the new order, each with `availability` set and any
  reason appended to `reasons`.
- `spendToZero` is a list of meter names. The engine passes the meters
  the registry marks. graybox passes none.
- `dropExpired` removes entries whose `resetsAt` has passed. The clock
  is the caller's argument.

| Value | When | Effect |
|---|---|---|
| `ok` | an entry for the route's meter says `ok` | none |
| `projected` | the worst entry says `projected` | moves below every healthy route, reason `meter-projected`. On a `spendToZero` meter it keeps its place, reason `meter-projected-spend-to-zero`. |
| `exhausted` | the worst entry says `exhausted` | removed, reason `meter-exhausted`. When exhaustion would remove every route, none is removed: each stays with `exhausted`, and the warning `availability-exhausted-all` is added. |
| `unknown` | the route names a meter, and no usable entry covers it, or availability was not read | none |
| `unmetered` | the route names no meter | none; availability never affects it |

- Healthy routes keep their input order. Demoted routes keep their input
  order among themselves.
- **Only an entry moves a route** (Kevin, 2026-10-01). When no entry
  covers a route's meter, a route that already carries `availability`
  keeps its value and its place in the input order. Otherwise it gets
  `unknown` or `unmetered`. Example: an answer orders `model-a`
  (`ok`), `model-s` (`projected`, on a spend-to-zero meter, so in its
  place), `model-c` (`unmetered`). `model-a` fails on quota. The walk
  adds one `exhausted` entry for `model-a`'s meter and calls the
  function on `[model-s, model-c]`. The result is `model-s`
  (`projected`), then `model-c` (`unmetered`), in that order, without a
  `spendToZero` list.

### Describe step

Source: [Specify the describe step's contract][t14], with the library
form from [Define model-router's library API and CLI surface][t19].

```
INPUT(text, partialQuery)
  -> CHECK_PRIVACY   privacy absent        -> FAIL query-invalid (field: privacy)
                     privacy: secret        -> FAIL describe-private
                     empty text             -> FAIL query-invalid
  -> ASK_JEV         task question only when partialQuery has neither task nor minimums;
                     one capability question per router.questions entry, always
  -> GATE            task confidence >= taskGate     -> use Jev's task
                     task confidence <  taskGate     -> use the guess, warning task-uncertain,
                                                        candidates in the describe block
                     capability probability >= capabilityThreshold -> add to needs
  -> RANK (CLI only: rank(filledQuery) and merge the describe block)
JEV_FAILED (no key, failed request, unusable answer)
  task needed     -> FAIL describe-failed (CLI exit 5), carrying Jev's own code
  task not needed -> continue, warning capabilities-unasked with Jev's code
```

- The step fills `task` and adds to `needs`. Every other field is the
  caller's. A capability answer only adds to `needs`. It never removes a
  capability the caller named.
- The task question is one choice over the declared tasks, with each
  task's `description` as its criterion. A task added to the registry is
  offered with no package change.
- The package asks no `stakes` question and no question about secret
  material.
- No request leaves the machine before `CHECK_PRIVACY` passes. Hosted
  Jev never receives text from a `privacy: secret` call.
- The package keeps no local-model fallback for the describe step.
- The Jev client's missing-key message names only `TYPESAFE_API_KEY`. It
  names no credential tool and no path.

### Consumer walk

The walk lives in each consumer. Neither package exports a walk
function, a walk table or a runner's failure classes. This is the one
written rule that `delegate` and graybox both follow
([Decide where the fallback walk lives][t9]).

```
ATTEMPT(route) -> SUCCESS                                     (terminal)
ATTEMPT(route) -> FAILURE
  FAILURE, class rejected                         -> ADVANCE
  FAILURE, class native, no work seen             -> ADVANCE
  FAILURE, retryable class, no work seen          -> MARK_METER -> ADVANCE
  FAILURE, native or retryable, work seen         -> STOP (report sessionId for a resume)
  FAILURE, class task or budget                   -> STOP
MARK_METER: when the route names a meter, add { meter, status: exhausted, resetsAt? }
            and call applyAvailability on the remaining routes
ADVANCE: record the attempt (label, class, runner message, code, fix);
         next route, or NO_ROUTE when none is left            (terminal)
```

- Every advance MUST be recorded, so a wrong registry entry stays
  visible even when a later route succeeds.
- A pinned route in `delegate` falls back like any other route.
- graybox MUST NOT walk past a route the Owner named. It refuses and
  says why.
- The class names are HCN's. A consumer that uses another runner maps
  that runner's failures to the same four outcomes.

## Error Handling

### `model-router`

Source: [Define contract version 1][t5], decision 14, with exit 5 from
[Specify the describe step's contract][t14].

| Outcome | CLI exit | Library |
|---|---|---|
| An answer with at least one route | 0 | returns the answer |
| An answer with no route | 3 | returns the answer |
| Invalid query, flags or subcommand | 2 | throws `RouterError`, `query-invalid` |
| `--describe` with `privacy: secret` | 2 | throws `RouterError`, `describe-private` |
| `--describe` with no `privacy`, or an empty description | 2 | throws `RouterError`, `query-invalid` |
| The registry cannot be loaded | 4 | rethrows `model-registry`'s `RegistryError` unchanged, with the path |
| `router`, `tasks` or `policy` invalid | 4 | throws `RouterError`, `registry-sections-invalid` |
| `config.json` invalid, or an explicit path missing | 4 | throws `RouterError`, `config-invalid` |
| Jev gave no answer and the task was needed | 5 | throws `RouterError`, `describe-failed` |
| Internal fault | 1 | throws |

- The CLI prints an answer on stdout, also at exit 3. It prints an error
  as `{"error": {...}}` on stderr. A loader error keeps
  `model-registry`'s code and message.
- `RouterError` carries `code`, `message`, `fix`, `field` and
  `problems[]`.
- A check against the query's shape or a fixed vocabulary is an error. A
  check against registry content is a warning. This is the standing
  rule that missing data is never a failure.
- When the hard limits remove every route, the answer is complete: it
  keeps the digest, the removed routes with reasons, and the warnings.
  The `privacy: secret` case keeps today's text, that the work runs
  locally or not at all, as a warning.

### `model-registry`

Source: [Define registry format version 1][t16], decisions 13, 14 and
16, with the two exits Kevin fixed on 2026-10-01.

`RegistryError` has `code`, `message`, `fix`, `path` and `problems[]`.
Each problem has `code`, `field`, `message` and `fix`. One run reports
every problem. The loader has errors only and no warnings channel.

| Code | Cause |
|---|---|
| `registry-missing` | no file at the resolved path |
| `registry-unreadable` | the file cannot be read or parsed |
| `format-missing` | no `format` field: not a version 1 registry |
| `format-unsupported` | a `format` higher than the loader knows, or an older major; the `fix` names `migrate` or an upgrade |
| `registry-invalid` | a shape error, an unknown field, or `null` |
| `label-duplicate` | two routes with the same label |
| `reference-unknown` | an undeclared rating, capability, meter or label in the format's own sections |
| `rating-mismatch` | a written rating that the stored table does not give and no override allows |

| Command | Outcome | Exit |
|---|---|---|
| `check` | the file loads; prints `{ "format", "digest", "path" }` | 0 |
| `check` | the loader fails; prints the error | 4 |
| `migrate` | the file is already current; prints "nothing to do" | 0 |
| `migrate` | migrated, validated and written | 0 |
| `migrate` | the migrated result is invalid; nothing replaced | 4 |
| `migrate` | `registry.json.format-<N>.bak` already exists; nothing written (`backup-exists`) | 2 |
| any | unknown command or flag (`usage-invalid`) | 2 |

Errors print as `{"error": {...}}` on stderr, as `model-router` prints
them.

### Availability codes

Source: [Define the router's configuration and availability input][t18],
decision 7.

| `availabilityNote` code | Cause |
|---|---|
| `availability-command-missing` | `--availability` given and no `availability.command` |
| `availability-command-failed` | not found, non-zero exit, or timeout (the command is killed); `message` says which |
| `availability-file-unreadable` | the `--availability-file` path cannot be read |
| `availability-reading-invalid` | not JSON, a wrong top level, or an unknown `format` |
| `availability-reading-stale` | `generatedAt` older than `maxAgeSeconds`, or in the future |

| Warning code | Cause | Raised by |
|---|---|---|
| `availability-exhausted-all` | exhaustion would remove every route, so none is removed | the function |
| `availability-entry-invalid` | an entry was skipped | the CLI's reader |
| `meter-undeclared` | an entry names a meter the registry does not declare | the engine |
| `meter-no-reading` | a reading was applied, and a meter that routes use has no entry | the engine |

A failed availability source MUST NOT fail routing. The CLI ranks
without availability, exits as it would otherwise, and fills
`availabilityNote` with a `fix`.

### Describe warnings

| Warning code | Cause |
|---|---|
| `task-uncertain` | Jev's task is below `taskGate`; the `fix` says to pass `task` |
| `capabilities-unasked` | Jev gave no answer when the task was not needed; the `fix` says to add any needed capability to `needs` |

### graybox codes

graybox uses `delegate`'s codes with the same meanings and adds
`route-not-admitted`, `owner-route-not-admitted` and
`owner-route-unavailable`. This is a convention. No package exports the
codes ([Specify how graybox uses the library][t11], decision 13).

## Security Considerations

### Private text and hosted models

- `privacy: secret` MUST keep only routes with `privacyEligible: true`.
  When none is left, the answer is empty, the CLI exits 3, and the
  warning says that the work runs locally or not at all.
- The describe step MUST refuse `privacy: secret` before any request
  (`describe-private`). With `--describe`, `privacy` has no default, so a
  caller that forgets it gets exit 2 and not a hosted call. Today's step
  sends the description to hosted Jev even for secret work. This RFC
  closes that gap.
- No scrubber is offered. A scanner finds credential shapes but not
  private prose, and a miss sends private text with a record that reads
  as a pass.
- `hosted` is REQUIRED on every route, because a wrong default either
  way is a privacy fault.
- The query is closed, so a misspelled `privacy` field cannot silently
  drop `secret`.

### Trust boundaries

- The registry file and `config.json` are trusted operator input. The
  loader validates their shape, but it cannot tell whether a fact is
  true.
- `availability.command` is an argv array, run with no shell, so quoting
  and shell expansion cannot change what runs. The command runs with the
  user's rights. Anyone who can write `config.json` can run a program as
  that user, and the same holds for any configuration that names a
  command.
- The availability document is untrusted data. A broken document only
  loses availability, and unknown fields are ignored.
- A wrong route string is found when the runner refuses it. The walk
  advances and records the refusal with a `fix`, so the bad entry stays
  visible.

### Credentials

- The Jev key comes only from `TYPESAFE_API_KEY`. `config.json` holds no
  key. Error messages name only the variable, never a credential tool or
  path.
- A missing key is reported only when the describe step needs Jev. A
  caller with a structured query needs no key.

### Private operator data in public repositories

Both repositories and both trackers become public. A public history
cannot be made private again.

- The packages MUST ship no personal registry data. The example registry
  uses placeholder names and placeholder figures.
- Before its first release, each repository's files and full git
  history MUST be audited for operator detail: registry values, route
  names or labels from the operator's registry, credential paths, and
  private tool or machine names. `model-router`'s code comes out of a
  private skills repository, so its first commits are the likeliest
  place for such detail.
- The skills repository runs a no-model-names check on each commit
  (see [Consumers](#consumers)).
- The operator's registry, the conversion script and the comparison
  table stay in the operator's existing private configuration sync and
  private task folders. Neither public repository holds them.

### Blast radius

- A broken registry stops every ranking call that uses it, with exit 4.
  graybox's list source is unaffected, and its router-source Tasks are
  refused with the loader's error. graybox never falls back to the list
  in the router's place.
- A bad `model-router` release reaches every skill on its next call,
  because skills resolve `@latest`. The undo for the skills is a revert
  and redeploy (see [Cutover](#cutover)). graybox meets a release only
  when it raises its pin.

## Versioning

Source: [Choose distribution and the release rule][t8], refined by
[Define contract version 1][t5], decision 16,
[Define registry format version 1][t16], decision 19, and
[Decide the cutover order for live consumers][t20], decisions 9 and 10.

### Below 1.0.0

Both packages start at 0.1.0. Below 1.0.0, a breaking change bumps the
minor and every other change bumps the patch. The rules below bind from
1.0.0. Both packages reach 1.0.0 at the same point: after graybox's
router source (rung 8) runs live. `model-registry` 1.0.0 goes first,
then `model-router` 1.0.0 with `model-registry` on `^1.0.0`.

### `model-registry`

`format` increases only when a valid file stops being valid or changes
meaning.

| Change | Release |
|---|---|
| A field becomes required, a field is removed or renamed, or a type or meaning changes | major, `format` + 1, with a migrate step |
| A loader result field is removed or changed, or a CLI command, flag or exit code changes | major, `format` unchanged |
| A new optional field or section, or a new effort level | minor |
| A new loader result field, or a new error or problem `code` | minor |
| The rating prompt changes the ratings it produces | minor |
| `message` or `fix` text, the example registry, or the rating prompt's wording | patch |

- Each major MUST ship the migration step from the previous major. The
  rule starts at format 2: version 1 is the first major, so no step
  leads to it.
- A package test migrates the previous major's example and validates the
  result.
- Release notes say whether the format changed.
- Known cost: the closed sections mean a file that uses a field added in
  a newer minor fails on an older loader.

### `model-router`

`contract` increases only on a query or answer break. A major for
another cause leaves it unchanged.

| Change | Release |
|---|---|
| An answer field is removed or renamed, or its type or meaning changes | major, `contract` + 1 |
| A query field becomes required, or a fixed query value is removed | major, `contract` + 1 |
| A new value in `placedBy`, `floor` or `availability` | major, `contract` + 1 |
| A break in the CLI commands, flags or exit codes, the library API, the config schema or the router sections' schema | major |
| A move to a new `model-registry` format major | major |
| A change to the availability document format (`format` + 1) | major |
| The same registry and query can rank differently | minor |
| The describe step's defaults change | minor |
| A new optional query field, a new accepted value for a fixed query field, or a new answer field | minor |
| A new optional `config.json` key | minor |
| A new error, warning or reason `code` | minor |
| A fix that changes no ranking | patch |
| `message` or `fix` text | patch |

Consumers branch on every value of `placedBy`, `floor` and
`availability`, so a new value there is a break. Codes are open.

The rows for the router sections' schema, the availability document
format and a new optional `config.json` key come from assumptions
recorded in [Define the router's registry sections][t17] and
[Define the router's configuration and availability input][t18]. They
apply the rule of [Choose distribution and the release rule][t8],
decision 7, to the schemas those tickets added.

### Dependencies and pins

- `model-router` depends on `model-registry` with a caret range on the
  major, as a regular dependency. A `model-registry` minor or patch
  reaches users without a `model-router` release.
- Skills MUST NOT pin a version. The CLI call resolves `@latest` on each
  call. Bundled imports are built at each deploy from the newest release
  in the major. A major release reaches the CLI before the next deploy
  reaches the bundles.
- graybox pins `model-router` at an exact version with
  `pnpm add --save-exact`. Its committed lockfile fixes both packages.
- When the skills meet a new format major, the next call fails with the
  loader's error until the user runs `model-registry migrate`. graybox
  meets it only when it raises its pin.

### Distribution

- Both packages publish to npm as `@dungle-scrubs/model-registry` and
  `@dungle-scrubs/model-router` with public access. Neither is
  distributed through Homebrew.
- Each repository goes public before its first npm release, after the
  audit in [Security Considerations](#security-considerations). npm
  does not support provenance for a private source repository.
- release-please cuts each release from conventional commits and writes
  the changelog. The publish job in the same workflow uses npm trusted
  publishing from a GitHub-hosted runner, with provenance (npm CLI
  11.5.1+, Node 22.14.0+).
- Each package name is created by hand once, with a 0.0.0 placeholder
  that holds only a README saying it is not released yet. 0.1.0 is the
  first release from GitHub Actions, so every version that contains
  code has provenance.

## Packages

### `@dungle-scrubs/model-registry`

| Export | Content |
|---|---|
| `loadRegistry({ path? })` | the loader's result; throws `RegistryError`. Synchronous. |
| the label builder | builds `<model key>@<harness>[/<provider>]` from a model key and a route |
| the effort ladder | `low < medium < high < xhigh < max` |
| `RegistryError` | the coded error |
| types | matching `registry.schema.json` |

Published files: `registry.schema.json`, one example registry with
placeholder names, and one optional agent prompt for filling ratings.
A package test validates the example against the schema and runs
`check` on it, so the example's placeholder table agrees with its
ratings.

No label parser ships.

```
model-registry check   [--registry <path>]
model-registry migrate [--registry <path>] [--dry-run]
```

- `check` runs the loader. The rating prompt's last step runs it.
- `migrate` finds the file by the loader's path order and applies each
  step in turn up to the current major. It validates the result with the
  same checks as `check` before it writes. It writes the backup
  `registry.json.format-<N>.bak` beside the file, then replaces the file.
  It refuses when that backup exists. `--dry-run` prints the migrated
  file on stdout and writes nothing.

#### The rating method

Source: [Specify the rating method][t15], which refines
[Decide how a user supplies registry data][t6], decision 6.

The package ships no code that produces ratings. It ships one agent
prompt, as documentation. The prompt tells an agent to:

1. Ask the user which ratings matter, which benchmarks feed each rating,
   and which models to rate. Artificial Analysis is the named example
   source.
2. When a benchmark has no table, or its published version differs from
   the version the table records, propose bands from the current
   figures, show the ratings those bands give, and write nothing until
   the user approves.
3. Read the figures and record each one with its date and effort level.
4. Write ratings by the table lookup, and write overrides with reasons.
5. Run `model-registry check`.

Jev has no part in rating. The package ships no default bands.

### `@dungle-scrubs/model-router`

| Kind | Exports |
|---|---|
| Ranking | `rank(query, { registry?, config?, availability? }): Answer`, synchronous and pure |
| Describe | `describe(text, partialQuery, { registry?, config? }): Promise<{ query, describe }>` |
| Read | `listTasks({ registry? }): TaskSummary[]` |
| Availability | `applyAvailability`, `dropExpired` |
| Jev client | `askJev`, `JevError`, and the types `JevQuestion`, `JevAnswer`, `JevResponse` |
| Errors | `RouterError` |
| Types | `Query`, `Answer`, `AnswerRoute`, `Coded`, `PinReport`, `DescribeBlock`, `TaskSummary`, `RouterConfig`, `AvailabilityEntry`, `AvailabilityDocument`, `AvailabilityResult`, `RankOptions`, `DescribeOptions` |
| Schema files | `query`, `answer`, `error`, `config`, `availability` and the router sections |

- `registry` takes a path or a result from `loadRegistry`. Absent, the
  loader's path order applies. A caller can load once and pass the same
  result to `listTasks` and `rank`, so the task list and the ranking come
  from the same bytes and the same digest.
- `config` takes a path or a settings object. An object is validated
  like a file.
- `rank`'s `availability` takes entries the caller has gathered. The
  caller runs `dropExpired`. Without it, metered routes are `unknown` and
  `availabilityNote` is `null`. `rank` takes the `spendToZero` meters
  from the registry.
- `listTasks` returns `[{ name, description }]` in file order, or `[]`
  with no `tasks` section. It validates the router's sections as `rank`
  does, so a caller never shows a model tasks that `rank` then refuses.
- The library does not re-export `model-registry`'s loader or label
  builder.
- The Jev client's key and retry helpers, the effort helpers and the
  engine's internal steps stay private.
- A package test validates the engine's answers against
  `answer.schema.json`. The query schema rejects undefined fields. The
  answer schema allows them.

```
model-router '<query>' | - [--registry <p>] [--config <p>] [--availability | --availability-file <p>] [--describe <f>]
model-router tasks [--registry <p>]
model-router check [--registry <p>] [--config <p>]
```

- A first argument that starts with `{` or `-` is the ranking call. Any
  other word MUST be `tasks` or `check`. An unknown word is exit 2 with a
  `fix` that lists the subcommands.
- The query is the positional JSON argument, or `-` to read stdin. No
  query argument is exit 2. There are no per-field flags.
- `--availability` runs `availability.command`. `--availability-file`
  reads a saved document. Both check `generatedAt` against
  `maxAgeSeconds` and apply `dropExpired`. Both together is exit 2.
  Without either, no availability is read.
- `--availability` with no configured command ranks without
  availability at exit 0 and fills `availabilityNote`.
- `--describe <file>` reads the description from the file, calls
  `describe` and then `rank`, and merges the describe block into the
  answer.
- `tasks` prints `listTasks` as JSON: exit 0 (also with `[]`), or exit 4.
- `check` loads the registry, validates the router's sections and
  `config.json`, and prints
  `{ "registryPath", "registryDigest", "configPath" }`. `configPath` is
  `null` when defaults apply. It exits 0 or 4. It runs no availability
  command and makes no Jev call.
- A flag that does not apply to a subcommand is exit 2.
- Today's `--runway`, `--runway-file`, `--tasks`, `--models` and
  `--matrix` get no alias.

### Where today's files go

Source: [Draw the package boundary][t3], with the later revisions
applied.

| File in `choose-model` today | Goes to |
|---|---|
| `choose.ts`: fact types, `loadRegistry`, fact validation | `model-registry` |
| `choose.ts`: query parsing, ranking, task and policy validation, the CLI | `model-router` (the matrix view is dropped) |
| `routing-query.ts`, without its pane questions | `model-router` (`describe`) |
| `jev.ts` | `model-router`, exported as `askJev` and `JevError` |
| `runway.ts`: reading the neutral format | `model-router` |
| `runway.ts`: the converter from the operator's quota tool | stays in the skills, private |
| `pane-questions.ts` | moves to `delegate`, its only remaining user |
| `rescore.ts` | retired ([Specify the rating method][t15]) |
| `fetch-figures.ts` | stays a private reading aid; imports `model-registry` only |
| `registry.json` | the operator's configuration, in neither repository |
| `REGISTRY.md` | the format description splits across the two packages' documentation; the calibration history stays private |
| tests | follow their source file |

## Consumers

### Skills

Source: [Specify how the skills move to the CLI][t10], with the CLI
names from [Define model-router's library API and CLI surface][t19].

| Consumer | Change |
|---|---|
| `choose-model` | `SKILL.md` keeps rules and pointers: when to query and when to skip; the fields a caller decides (`stakes`, `privacy`, `excludeFamilies`, `spec`, and `pin` only with `task` or `minimums`); the invocation and the quota converter step; what to do on exits 0, 2, 3, 4 and 5; acting on each `fix`; the work-description writing rules; stating `privacy` with `--describe`; acting on `task-uncertain`. It uses `model-router tasks` and drops `--models` and `--matrix`. Field types, defaults and answer fields are read from the package schemas, not copied into the skill. |
| `delegate` | Reads `routes` in place of `selection` and `fallbacks`, and `removed` in place of `excluded`. Omits `--effort` when a route has no `effort`. Applies the consumer walk rule. Reports per [`delegate`'s report](#delegates-report). `delegate.ts --choice <file>` never runs the router and never handles the CLI's exits. Five gate scripts import the Jev client, and `delegate.ts` imports the availability functions. |
| `jev-sweep` | Imports the Jev client. |
| `interrogate` | `panel.ts` runs the CLI in place of an in-process call. Its test uses the fixture registry. |
| `audit-skills` | Its pinned panel routes become pins in queries that carry a `task`. |
| Operator's registry refresh | Imports `model-registry` only (loader and label builder). Its routing diff runs the CLI with `--registry <old>` and `--registry <new>`. It runs `delegate`'s consistency script after each refresh. |

- **Bundling.** The skills repository declares
  `@dungle-scrubs/model-router` with a caret range on the major, so its
  tests run against it. The deploy step bundles each importing script
  into a self-contained `.mjs` with the router code inlined, from the
  newest release in the major. Those scripts run as `node <script>.mjs`.
  Nothing is installed beside the deployed skills.
- **Fixtures.** Skill tests run on fixtures committed in the skills
  repository. `delegate`'s tests use answer files validated against
  `answer.schema.json`. `interrogate`'s test runs the CLI with
  `--registry` on a fixture registry with placeholder names. No skill
  test reads the operator's registry. The published example registry is
  not used as the fixture, because a patch may change it.
- **No-model-names check.** A script in the skills repository, run by
  the pre-commit hook on each commit that touches a skill and by the
  test command, scans every text file under the skills tree. Every
  route label, model key and `modelId` in the operator's registry counts
  as a model name. A match fails the check, unless it is the `pin` of a
  query that also carries `task` or `minimums`. On a machine with no
  registry file the script prints that it skipped and exits 0.
- **Consistency script.** `delegate`'s registry consistency tests become
  one script with two callers: the pre-commit check and the registry
  refresh. It holds `delegate`'s list of harnesses that accept
  `--skills` against the `skills` capability on each route. It skips
  with a notice when no registry file exists.

### graybox

Source: [Decide whether graybox runs without the router][t12] and
[Specify how graybox uses the library][t11].

- **One interface, two sources.** In: the work need, the admitted
  routes and graybox's availability entries. Out: the admitted routes
  in order, each with its identity, meter, availability and reason, plus
  the source identity. The Owner-named rule, the admitted-route check
  and the walk act on that output and do not know which source produced
  it.
- **List source** (the default). It uses the written order only and
  ignores the work need. It applies availability through
  `applyAvailability`. graybox holds no facts about models.
- **Router source.** The Primary picks a task from the names and
  descriptions that `listTasks` returns, and emits `task=<name>` with
  the Task directive. `routing.defaultNeed` applies when it emits none.
  graybox calls `loadRegistry`, `listTasks` and `rank` with one loaded
  registry, and keeps the ranked routes that match an admitted entry on
  `harness` + `modelId` + `provider`. graybox does not use the describe
  step.
- **Owner-named routes.** The Primary emits a route label only when the
  Owner named a model. The Primary's prompt describes no models; graybox
  puts the admitted labels in it. An Owner-named route skips the router
  on both sources. graybox checks it against the admitted list and the
  availability function only. It is never walked past. When it cannot
  run, graybox refuses with `owner-route-not-admitted` or
  `owner-route-unavailable`.
- **Loading.** graybox loads the registry for each routing decision and
  once at start. An edit applies to the next Task without a restart. The
  start check shows a broken file in the application interface at once.
  It does not stop graybox: list-source Tasks run, and each
  router-source Task is refused when its load fails. graybox never uses
  the list in the router's place.
- **Availability.** graybox reads no quota source. Its entries are its
  own record: `exhausted` entries from the runner's usage or quota
  failures, expired at the reset time with `dropExpired`. It never
  produces `projected` and passes no `spendToZero` list.
- **Effort.** The entry's `effort` wins when written. Otherwise the
  router's `effort` applies. With neither, graybox omits the effort
  flag. When the entry overrides the router, the decision record keeps
  the router's level.
- **No admitted route.** When no admitted route is available, graybox
  refuses the Task before launch and names each route and its reason.
  This covers an empty `routes` list, an answer with no admitted route,
  and every admitted route `exhausted`.
- **Routing decisions.** Each Task holds a list of routing decisions,
  and each attempt references one. A decision holds the source and its
  identity, the chooser (`owner` or `source`), the need as applied
  (router source), the ordered routes received (graybox's label, the
  registry label, availability, reason), and the walk's advances (label,
  failure class, code, the runner's message, `fix`). A route switch, or a
  resume that routes again, adds a decision and never overwrites one.
- **Source identity.** A router-source decision records `routerVersion`
  and `registryDigest`. A list-source decision records `sha256:<hex>`
  over the canonical JSON of `routing.routes` with keys sorted.
- **Setup.** With no `routing.primary` or no `routing.routes`, graybox
  starts, and the application interface shows a setup message naming the
  file and the missing key. No Primary turn and no Task runs until the
  key exists. graybox's documentation ships an example `routing`
  section with placeholder entries. There are no built-in default
  routes.
- **No model names in source.** The environment variable that selects
  the Primary's route, the built-in Primary default, the route constants,
  the admission records, the provider relays, the isolated-project types
  that allow one model, and the web UI selectors all read the configured
  entries. No model name remains in graybox source outside tests.
- **Dependency.** `model-router` is a regular dependency at an exact
  version, loaded only when the source is the router.

#### Changes to graybox's model-routing plan

| Rung | Change |
|---|---|
| 5 | **Routes in configuration** on the list source. Routes, the Primary's route and admission move to `routing`; the Primary emits a label only for an Owner-named model; availability uses the rule of `applyAvailability`. Until `model-router` publishes the export, rung 5 carries a temporary local copy of the rule, which MUST match [Availability rule](#availability-rule). Acceptance: with one meter `exhausted`, a Task with no model named starts on the next available list entry; the same Task with the exhausted route named by the Owner is refused with `owner-route-unavailable`; no model name remains in graybox source outside tests. |
| 6 | **Fallback** follows the consumer walk rule on the list source. An unavailable failure adds an `exhausted` entry on the route's meter. Each advance is recorded with its code and `fix`. Acceptance: the current acceptance, plus each advance visible in the record. |
| 7 | **Wayfinder end to end**, unchanged; it runs on the list source. |
| 8 (new) | **Router source.** The Primary picks a task, graybox filters the answer to admitted entries, and each decision records `routerVersion` and `registryDigest`. A broken registry refuses router-source Tasks and shows the start-check message. Acceptance: a fixture registry with placeholder names ranks two admitted routes, and an edit to it changes the recorded digest on the next Task without a restart. |

The plan's open question on fallback order is answered: the source's
order, and a fallback may cross harnesses.

## Cutover

Source: [Decide the cutover order for live consumers][t20].

### The order

| Step | What happens | Waits for |
|---|---|---|
| A | graybox rung 5 on the list source, with the temporary availability rule | nothing |
| B | `model-registry` audited, public, 0.1.0 | its implementation |
| C | `model-router` audited, public, 0.1.0 | B |
| D | graybox switches to the exported availability functions and drops its copy | C |
| E | conversion script written; converted registry and `config.json` pass both checks | B, C |
| F | skills step 1: bundler and Jev client imports | C |
| G | ranking comparison accepted; conversion rerun | E |
| H | rehearsed undo, then the ranking switch deployed | F, G |
| I | graybox rung 8 proved live | C, E |
| J | `model-registry` 1.0.0, then `model-router` 1.0.0 | H, I |

graybox rungs 6 and 7 run on the list source at any point after A.
Until step H, the skills run today's `choose.ts` and `delegate` on the
old file.

### Steps in detail

- **Audit and release (B, C).** Both repositories start private. Each
  goes public only after the audit in
  [Security Considerations](#security-considerations). Releases go in
  dependency order, with the placeholder and trusted-publishing steps of
  [Versioning](#versioning).
- **Conversion (E, G).** The converted registry and the old file exist
  side by side. A repeatable script reads the old file and writes format
  1 to the loader's XDG path. It adds what format 1 and the router's
  sections need: bands, overrides with reasons, task `rank` lists,
  floors in place of facets, the `requires` and `reasoning` renames,
  policy names, and the `router` section with `rank` and the two
  capability questions written into code today. The script proposes
  these additions and the operator approves them. Registry edits go into
  the old file only. The script runs a last time just before the switch,
  and `model-registry check` and `model-router check` validate its
  output. The script and its output hold operator data, so they live
  outside both repositories. No package ships the script.
- **Ranking comparison (G).** Every task in the operator's registry, at
  every stakes level, runs through today's engine on the old file and
  through the new CLI on the converted file. A table puts the two route
  orders side by side and marks each difference. The switch waits until
  the operator accepts every difference, or until the conversion script
  is fixed and rerun.
- **Skills step 1 (F).** The deploy step gains the bundler. Every skill
  script that imports the Jev client moves to `askJev` and `JevError`
  from `@dungle-scrubs/model-router`. This step touches no ranking and
  no registry data.
- **Skills step 2, the ranking switch (H), as one commit and one
  deploy.** `choose-model`'s `SKILL.md` moves to the CLI and to
  `model-router tasks`. `delegate` reads `routes` and imports the
  availability function. `interrogate` runs the CLI. `audit-skills`
  turns its pinned routes into pins with a `task`. The quota converter
  prints `format: 1` with meter names the registry declares. Callers
  move from `--runway` to `--availability`. The operator's
  `config.json` names the converter in `availability.command`.
  `choose.ts`, the modules that move to `model-router`, and the old
  registry file leave the skills repository. These changes cannot be
  split: `delegate` reads the old answer's `selection` and `fallbacks`,
  and the old engine reads the old converter's output.
- **graybox (A, D, I).** graybox moves on its own track. Rung 5 needs no
  package. Once `model-router` 0.1.0 is published, the graybox commit
  that imports `applyAvailability` and `dropExpired` at an exact version
  removes the local copy. Rung 8 needs the converted registry and a
  `model-router` release.
- **1.0.0 (J).** Rung 8 is the first live library call of `loadRegistry`,
  `listTasks` and `rank`. The API freezes only after its library
  consumer has used it.

### Rollback

- **Ranking switch (H).** The undo is a revert of the switch commit and
  a redeploy. The revert brings back `choose.ts`, the old registry file
  and the old converter. The converted file can stay, because the old
  engine never reads it. Before the live deploy, on a branch, the switch
  MUST be deployed to a scratch deploy target, one ranking run, the
  commit reverted and deployed to the same target, and today's engine
  confirmed to answer from the old file. An undo that was never run is
  not proven to work.
- **Skills step 1 (F).** A revert of that commit and a redeploy. It is a
  separate commit so that a bundler fault and a ranking fault never
  arrive together.
- **graybox.** graybox's committed lockfile keeps it on a known package
  version. It meets a new release only when it raises its pin.

## Implementation Notes

### Measurements behind the decisions

| Fact | Figure | Source |
|---|---|---|
| Chosen `npx` invocation, warm cache | about 450 ms per call; an installed binary about 87 ms | [Choose distribution and the release rule][t8] |
| Read, parse and SHA-256 of an operator-sized registry | under 1 ms | [Specify how graybox uses the library][t11] |
| Today's describe step: task accuracy | 84%; 72% of rows at or above the 0.85 gate, all but three correct | [Specify the describe step's contract][t14] |
| Today's `stakes` question accuracy | 58% | [Specify the describe step's contract][t14] |
| Source that becomes `model-router` | four files, 2,177 lines, no third-party imports | [Decide whether graybox runs without the router][t12] |
| HCN's refusal of its own input | exit 2, class `rejected`, not retryable, before the harness starts | [Decide whether the router contract assumes HCN][t13] |

### Assumptions carried from the tickets

- The chosen `npx` invocation needs the npm registry to be reachable on
  every call. Offline behavior was not tested.
- npm needs a package name to exist before a trusted publisher can be
  configured. If it does not, the 0.0.0 placeholder is not needed.
- The runner's event stream shows a tool call or model output before a
  failure whenever work was done. A harness that changes files without
  emitting either defeats the work-seen check.
- Ratings are integers, and ratings stay per model: every route of a
  model inherits them. Route-level facts are cost and response time.
  Response time is a figure copied as read, not a banded rating.
- A model's figures are read at one effort level, the level the user's
  routes run at.
- The skills repository's deploy step can run a bundler and deploy to a
  scratch target.

### Left to implementation

The tickets name these as implementation: the internal module layout,
the bundler, help text, the schema file layout, the TypeScript type
names beyond the export list, the rating prompt's wording and file name,
the conversion script, the comparison table's layout, the audit tooling,
the Codex sandbox field name and the `access` values in graybox, and the
consumers' exact report field names beyond those this RFC lists.
`--help` and `--version` print and exit 0, and are not part of the
contract.

The implementation also names the warning and reason codes that no
ticket named, and the label builder and ladder exports (Kevin,
2026-10-01). Each package's documentation MUST list every code it can
emit. The unnamed codes are: the unknown-task, unknown-need,
unknown-rating and unknown-family warnings; the effort-lowered warning;
the no-matching-policy warning; the policy-route-removed warning; the
hard-limit removal reasons; the floor reasons; and the pin-not-used
reasons.

## Alternatives Considered

Each line names the decision that rejected the alternative.

| Alternative | Why it was rejected | Ticket |
|---|---|---|
| One package holding the engine in this repository | A storage-only package lets anyone validate a file without the engine; the chooser is one shared package | [Draw the package boundary][t3] |
| The engine reads quota itself | The engine must be pure and testable; the quota tool is the operator's own | [Decide how availability and quota reach the engine][t4] |
| An HCN adapter or a check against HCN | The router would track HCN releases; the shared part is four flags; HCN refuses bad input before any work | [Decide whether the router contract assumes HCN][t13] |
| An exported walk function or outcome table | The shared part is a few lines; reading the runner's failure is runner-specific | [Decide where the fallback walk lives][t9] |
| Unknown task ranked cheapest first, or an error | A misspelled task would go to the cheapest route; missing data is never a failure | [Define contract version 1][t5] |
| A `toHcn` or HCN-shaped contract | A user without HCN could not add a harness | [Decide whether the router contract assumes HCN][t13] |
| JSONC, YAML or TOML for the registry | Programs rewrite the file; plain JSON needs no parser and has a simple digest | [Decide how a user supplies registry data][t6] |
| Ranking models against each other for ratings | Adding a model would move the ratings of unchanged models | [Specify the rating method][t15] |
| A `harnesses` section | Its upkeep exceeds its use; harness stays a plain string | [Define registry format version 1][t16] |
| A migration step from today's format | It would carry one private registry's quirks in the package | [Define registry format version 1][t16] |
| Two policy kinds (`preferred`, `settledSpec`) | Two shapes and two rule sets for one behavior | [Define the router's registry sections][t17] |
| A describe-only subcommand, or `describe` as an option on `rank` | A second call and error surface; `rank` would become async | [Specify the describe step's contract][t14], [Define model-router's library API and CLI surface][t19] |
| A scrubber for private text | A miss sends private text with a record that reads as a pass | [Specify the describe step's contract][t14] |
| `models` and `matrix` read views | A second public format for the same facts; one user | [Define model-router's library API and CLI surface][t19] |
| A global install for the skills | Each machine would stay on the version last installed | [Choose distribution and the release rule][t8] |
| Committed bundles, or `node_modules` beside the deployed skills | Bundles go stale; the agent directory holds only entries the operator places | [Specify how the skills move to the CLI][t10] |
| graybox auto-detecting the router | A registry file outside graybox's configuration would change graybox's routing | [Decide whether graybox runs without the router][t12] |
| graybox's Primary picking a route as a pin | The prompt would have to describe models; only the registry qualifies models | [Specify how graybox uses the library][t11] |
| Built-in default routes in graybox | They put model names back in code | [Specify how graybox uses the library][t11] |
| Creating `model-router` public from its first commit | Its first commits come from a private repository; a public history cannot be made private again | [Decide the cutover order for live consumers][t20] |
| 1.0.0 at graybox rung 5 | A problem found at rung 8 would cost a major | [Decide the cutover order for live consumers][t20] |

## Open Questions

Each of these SHOULD be resolved before this RFC moves from Draft to
Accepted. Each one renders a closed ticket where its wording leaves room.
None adds a capability.

1. **The effort resolution order.**
   [Define contract version 1][t5], decision 9, says "a model's fixed
   level wins over the default" and "the model's ceiling caps the
   default". [Effort](#effort) reads "the default" as the level that
   would otherwise apply: a policy, query or task level, else
   `effort.default`. That is how today's engine treats its task level.
   - Option A (recommended): `fixedEffort` replaces, and `maxEffort`
     caps, every requested level, and a lowering by `maxEffort` adds a
     warning as a lowering by the ceiling does.
   - Option B: `fixedEffort` and `maxEffort` act only on
     `effort.default`. An explicit query or task level passes through
     to the `config.json` ceiling.
   - Decider: Kevin.
2. **Missing sort values.** [Sort order](#sort-order) says a route whose model
   lacks a `rank` rating sorts below. The tickets do not say where a
   route with no `cost`, or with no `responseSeconds` under
   `prefer: speed`, sorts, or what breaks a tie between two models after
   route order.
   - Option A (recommended): a missing `cost` or `responseSeconds` sorts
     below every route that has it, as a missing `rank` rating does. The
     last tie-break is file order.
   - Option B: a missing value sorts as the worst value on the scale.
     The last tie-break is file order.
   - Decider: Kevin.
3. **The JSON shape of the declaration sections, and which may be
   absent.** [Define registry format version 1][t16] says `ratings`
   declares each name "with a description" and `capabilities` maps each
   name "to a one-sentence description". `meters` maps each name to an
   object. The ticket fixes `format` as required and says nothing on
   whether `ratings`, `capabilities`, `meters`, `models` or
   `calibration` may be absent.
   - Option A (recommended): `ratings` and `capabilities` map a name to
     a string (`"ratings": { "coding": "Writes and changes code." }`).
     `models` is required. `ratings`, `capabilities`, `meters` and
     `calibration` are optional, and an absent section declares nothing.
   - Option B: both map a name to an object with `description` and
     optional `notes`, like `meters`. Every section except
     `calibration` is required, and an empty map declares nothing.
   - Decider: Kevin.
4. **Codes and export names the tickets left unnamed.** The tickets name
   no code for: the unknown-task, unknown-need, unknown-rating and
   unknown-family warnings; the effort-lowered warning; the no-matching-
   policy warning; the policy-route-removed warning; the hard-limit
   removal reasons; the floor reasons; and the pin-not-used reasons.
   They also leave the names of the label builder and the ladder export
   open. Codes are open under [Versioning](#versioning), so adding one
   later is a minor.
   - Option A (recommended): implementation names them, and the
     package's schema documentation lists every code.
   - Option B: this RFC names each code before acceptance.
   - Decider: Kevin.

## References

### Normative

- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) - requirement
  keywords.
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) - the
  form of every published schema.
- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/) -
  the configuration path defaults.
- The closed tickets this RFC renders:
  - [Inventory what consumers read from choose-model today][t2]
  - [Draw the package boundary][t3]
  - [Decide how availability and quota reach the engine][t4]
  - [Define contract version 1][t5]
  - [Decide how a user supplies registry data][t6]
  - [Establish the distribution options][t7]
  - [Choose distribution and the release rule][t8]
  - [Decide where the fallback walk lives][t9]
  - [Specify how the skills move to the CLI][t10]
  - [Specify how graybox uses the library][t11]
  - [Decide whether graybox runs without the router][t12]
  - [Decide whether the router contract assumes HCN][t13]
  - [Specify the describe step's contract][t14]
  - [Specify the rating method][t15]
  - [Define registry format version 1][t16]
  - [Define the router's registry sections][t17]
  - [Define the router's configuration and availability input][t18]
  - [Define model-router's library API and CLI surface][t19]
  - [Decide the cutover order for live consumers][t20]

### Informative

- [Map: shared model registry][map] - the decision map, its Notes and
  its Out of scope list.
- graybox `docs/plans/model-routing.md` on branch `feat/model-routing` -
  the rungs this RFC changes.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) -
  the publish path and its requirements.
- [release-please](https://github.com/googleapis/release-please) - the
  release tool.

[map]: https://github.com/dungle-scrubs/model-registry/issues/1
[t2]: https://github.com/dungle-scrubs/model-registry/issues/2
[t3]: https://github.com/dungle-scrubs/model-registry/issues/3
[t4]: https://github.com/dungle-scrubs/model-registry/issues/4
[t5]: https://github.com/dungle-scrubs/model-registry/issues/5
[t6]: https://github.com/dungle-scrubs/model-registry/issues/6
[t7]: https://github.com/dungle-scrubs/model-registry/issues/7
[t8]: https://github.com/dungle-scrubs/model-registry/issues/8
[t9]: https://github.com/dungle-scrubs/model-registry/issues/9
[t10]: https://github.com/dungle-scrubs/model-registry/issues/10
[t11]: https://github.com/dungle-scrubs/model-registry/issues/11
[t12]: https://github.com/dungle-scrubs/model-registry/issues/12
[t13]: https://github.com/dungle-scrubs/model-registry/issues/13
[t14]: https://github.com/dungle-scrubs/model-registry/issues/14
[t15]: https://github.com/dungle-scrubs/model-registry/issues/15
[t16]: https://github.com/dungle-scrubs/model-registry/issues/16
[t17]: https://github.com/dungle-scrubs/model-registry/issues/17
[t18]: https://github.com/dungle-scrubs/model-registry/issues/18
[t19]: https://github.com/dungle-scrubs/model-registry/issues/19
[t20]: https://github.com/dungle-scrubs/model-registry/issues/20
