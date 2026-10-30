# Creating a new registry

Follow this file when the target has no registry file yet: the
`model-registry check` run in `SKILL.md` reports `registry-missing`, and its
`path` is the file to create. Keep that path for every later command.

## The starting state

A new registry has no facts to read. It has no `ratings`, `capabilities`,
`meters`, `models`, `tasks`, `router`, `profiles` or `calibration`, no
snapshots in `lists/` and no reads in `reads/`. So:

- Skip reading the target's existing shared facts.
- Skip the rebuild in `references/snapshots.md`; there is nothing to diff.
- Every benchmark the user approves needs a new pinned read. The Step 4
  approval in `references/build-profile.md` is the yes to taking it.
- Keep everything in a draft until approval. The draft is the whole file:
  every fact the interview, discovery and the rating handoff produce. The
  rating handoff rates the draft's models and routes.
- Create the registry file only at the approved write. `lists/` and
  `reads/` are created beside it when the first read is saved.

## An intake file beside the target

When `intake.json` sits beside the target, the init wizard already asked
the questions this file asks. Read it, and take the answers from it. It
matches the shipped `intake.schema.json`, so a file that does not match is
not an intake and the interview runs as usual.

- `harnesses`: the harnesses to build routes for. Skip the platform
  question and use these harnesses.
- `benchmarks`: the benchmarks the user approved. Skip the benchmark
  question and offer exactly these.
- `artificialAnalysisKey`: `saved` when the key file holds a key, `none`
  when it does not.

The intake never holds the key itself. When it says `saved`, the key sits in
`$XDG_CONFIG_HOME/model-registry/artificial-analysis.env`, and the read
command for that source runs with the key in its environment only. Load the
file into the environment of that one command; never read the key, print
it, or copy it into the conversation.

Every other question this file asks still stands: the ratings, the router
order, the tasks, the capabilities, the profile identity and the meters.

## The interview

Run Steps 1 to 6 of `references/build-profile.md` in order, with these
additions. Each one is still one question at a time.

1. **Ratings (Step 4).** Each rating the user names is declared in
   `ratings` with a one-line description.
2. **Router order (after Step 4).** Ask the order in which the declared
   ratings rank routes when a query names no known task. That list is
   `router.rank`. Every name in it must be a declared rating.
3. **Tasks (Step 2, then Shared task floors in Step 6).** For each task the
   purpose names, ask its name and a one-line `description`, then its floors
   at `low`, `normal` and `high` stakes, then its `rank`: the ordered
   declared ratings that sort routes for that task. Ask for `needs` (the
   capabilities the task requires) and `effort` only when the user's answers
   point to them.
4. **Capabilities (Step 6 discovery).** Declare each capability a route
   carries or a task needs in `capabilities`, with a one-line description.
   A route's capabilities come from cited evidence or the user's answer.
5. **Profile identity (before the proposal).** Ask the profile's name and
   its one-line `description`. Recommend `default` when this is the user's
   only set: a declared `default` replaces the implicit one, which holds
   every route. Any other name leaves the implicit `default` in place as
   well.
6. **Meters (Step 1).** Declare a meter in `meters` only when a plan limits
   use and the user wants that limit tracked; a route names it in `meter`.

## Route labels

A route's label is the model key, `@`, and the route's `harness`, plus
`/` and the `provider` when the route has one: `model-a@harness-x`, or
`model-a@harness-y/provider-1`. The model key is the key under `models`,
never the `modelId`. Profile `routes`, gap records and route-level figures
and overrides all use these labels.

## The skeleton

A new file has this shape. Every name and value here is a placeholder; the
interview supplies each one. It passes `model-registry check` and
`model-router check` as written.

```json
{
  "format": 1,
  "ratings": {
    "coding": "Writes and changes code to a spec.",
    "reasoning": "Plans and analyses multi-step problems."
  },
  "capabilities": {
    "browser": "Can drive a web browser."
  },
  "models": {
    "model-a": {
      "family": "family-a",
      "maxEffort": "high",
      "ratings": { "coding": 7, "reasoning": 6 },
      "routes": [
        {
          "harness": "harness-x",
          "modelId": "model-id-a",
          "hosted": true,
          "capabilities": ["browser"]
        },
        {
          "harness": "harness-y",
          "modelId": "model-id-a",
          "provider": "provider-1",
          "hosted": true
        }
      ]
    }
  },
  "router": {
    "rank": ["coding", "reasoning"]
  },
  "tasks": {
    "task-a": {
      "description": "Implement a change the user has specified.",
      "minimums": {
        "low": { "coding": 5 },
        "normal": { "coding": 6 },
        "high": { "coding": 7 }
      },
      "rank": ["coding", "reasoning"],
      "needs": ["browser"]
    }
  },
  "profiles": {
    "profile-a": {
      "description": "Everyday coding work on the user's own plans.",
      "routes": ["model-a@harness-x", "model-a@harness-y/provider-1"]
    }
  }
}
```

Where each part comes from:

| Part | Filled from |
|---|---|
| `format` | Always `1`. |
| `ratings` | Step 4: each rating the user names, with a one-line description. |
| `capabilities` | Discovery and tasks: each capability a route carries or a task needs. |
| `models` | Discovery: the model key, `family`, effort limits, and `routes` in the Step 1 platform order. |
| A route | Discovery: `harness`, `modelId`, `provider`, `hosted`, `capabilities`, `meter`, each from evidence or the user. |
| Model `ratings`, route `cost` | The rating handoff, under `references/rating.md`. |
| `router.rank` | The router order question. |
| `tasks` | Step 2 and Shared task floors: `description`, `minimums.low`, `minimums.normal`, `minimums.high`, `rank`, and `needs` or `effort` when asked. |
| `profiles` | The profile identity question and the proposal's membership, with `gaps` when the user accepts any. |
| `calibration` | The rating handoff: benchmarks, feeds, figures, overrides and `handSet`. Not shown above. |
| `meters` | Step 1, only when a plan meter is tracked. Not shown above. |

## The proposal and the write

Use the proposal in `references/build-profile.md`, and show the complete
draft file in it. There are no other declared profiles for shared changes
to reach. After approval, write the draft to a temporary file beside the
target, run `model-registry check --registry <draft>` and
`model-router check --registry <draft>`, and move the draft into place
only when both exit 0. A draft that fails is fixed and checked again, or
reported to the user; it is never written to the target. Then run the
finishing checks in `SKILL.md`.
