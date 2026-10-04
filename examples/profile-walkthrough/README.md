# Profile walkthrough (placeholder data)

A transcript of one profile build with `prompts/profile-builder.md`, from the
opening request through the first rebuild. Every name, id, price and figure
here is a placeholder: `platform-a`, `aggregator-a`, `model-a`, `harness-x`,
`provider-2`, `plan-a`, and `example.org` sources. No figure below is labelled
with a real benchmark publisher.

The kept artifacts beside this README:

- `registry.json` - the final registry, after the rebuild edit.
- `registry-before-rebuild.json` - the registry as first approved, so the
  first checks' output can be recomputed.
- `lists/` - the approved model list snapshots after the rebuild.
- `lists-before-rebuild/` - the aggregator snapshot as first approved, so the
  rebuild diff can be recomputed.
- `reads/` - the pinned benchmark reads the bands and figures came from.

## The opening request

> Build me a profile named builder-pool for daily coding. I have platform-a
> on plan-a and an aggregator-a key. Keep it under 50 USD a month and make it
> a narrow, cheap set. Rate coding and taste.

The opening request names no registry file, so the builder settles on the
resolved default that `model-registry check` reports in its `path` output,
with `lists/` and `reads/` beside it. The opening request already answers
three interview facts, so the builder says so and skips those steps:

- Step 1 - Platforms and plans: skipped. platform-a on plan-a, plus
  aggregator-a with its key, named in the order that orders each model's
  `routes` array.
- Step 2 - Purpose and budget: skipped. Daily coding, under 50 USD a month.
- Step 5 - Desired score range: skipped. Narrow and cheap.

## Step 3 - Aggregator narrowing

**Agent:** Before I read anything from aggregator-a - do you want a price
ceiling, a provider subset, or both?

**User:** Ceiling 2.50 USD per million input tokens at list price. Any
provider.

Recorded before the read: currency USD, unit per million input tokens, price
basis list price, providers any. The ceiling travels into the aggregator
snapshot's `method` field.

## Step 4 - Ratings and benchmark approval

**Agent:** Which ratings matter for this pool, and which benchmark feeds
each one? The suggestion table offers sources; you approve or replace each.

**User:** Coding from the engines index at example.org, cost per task for
route cost at example.org. Taste is mine to set; show me the leaderboard
read as evidence.

Approved sources: `engines` feeding `coding`, `cost-per-task` feeding `cost`,
and the pinned leaderboard read as taste evidence only. The numeric bands
are computed later and approved before any write.

## Step 6 - Discovery, rating, then gap decisions

### Discovery reads

The builder checks each source's current documentation for its command
shape, then reads every list as a local command, so no credential enters
the conversation. The first two reads:

| Read | Evidence | Snapshot | Result |
|---|---|---|---|
| harness-x list, platform-a scope | Harness list (preferred) | `lists/platform-a-harness.json` | `model-id-a`. The user's plan page confirms plan-a includes it. |
| catalog at revision `r3v-0c4t`, public | Pinned catalog - suggests only | `lists/catalog.json` | Suggested the then-unknown platform-b with `model-id-b` and `model-id-d`. |

The catalog suggests platform-b, which the user did not list, so the builder
asks about it as one question:

**Agent:** The catalog suggests platform-b, which you did not list. Do you
have access to it, and on which plan or account? Where should it sit in your
platform order?

**User:** Yes - an API key, pay as you go; put it after aggregator-a.

Only on that yes does platform-b join the platform list, at the position the
user gave. The builder then reads it. The remaining two reads:

| Read | Evidence | Snapshot | Result |
|---|---|---|---|
| harness-y list, platform-b scope | Harness confirmation | `lists/platform-b-harness.json` | `model-id-b` reachable, so it may become a route. `model-id-d` is absent: the harness cannot reach it, so it stays out. |
| aggregator-a read with the Step 3 ceiling | Endpoint, filtered locally | `lists/aggregator-a.json` (first version kept at `lists-before-rebuild/`) | Passing set `model-id-c`; `model-id-e` at 4.00 USD per million input tokens filtered out before rating. |

Only the harness-y read confirmed a model on platform-b. Research was not
needed.

### Rating handoff

The builder hands rating to `prompts/rating.md` with the pool the approved
snapshots define: model-a (platform-a), model-c (aggregator-a passing set),
model-b (platform-b, harness-confirmed). It runs the rating prompt's Steps 1
to 3 - the Step 1 answers carry over from interview Step 4 - and computes
the Step 4 values without writing anything. The rating prompt works from the
user's pinned reads, kept in `reads/`:

- `engines` feeds `coding`. Its decile bands over the 20-row pinned read:

  | Score | at |
  |---|---|
  | 10 | 49 |
  | 9 | 47 |
  | 8 | 45 |
  | 7 | 43 |
  | 6 | 41 |
  | 5 | 39 |
  | 4 | 37 |
  | 3 | 35 |
  | 2 | 33 |
  | 1 | 31 |

  **User:** Approved.

  Figures: model-a 44 at effort high scores coding 7; model-c 46 at effort
  high scores coding 8.

- `cost-per-task` feeds `cost`. Its decile bands over the 20-row pinned read:

  | Score | at |
  |---|---|
  | 10 | 0.3 |
  | 9 | 0.4 |
  | 8 | 0.5 |
  | 7 | 0.6 |
  | 6 | 0.7 |
  | 5 | 0.8 |
  | 4 | 0.9 |
  | 3 | 1 |
  | 2 | 1.1 |
  | 1 | 1.2 |

  **User:** Approved.

  Figures: model-b's route 0.45 scores cost 8; model-c's route 0.35 scores
  cost 9.

  **Agent:** model-a@harness-x is a subscription route on plan-a: no
  per-task price exists to read. What cost should it carry?

  **User:** Cost 9. While the plan lasts it is nearly free per task.

  The written cost 9 carries an override with that reason.

- Taste stays hand-set, with the pinned leaderboard read
  (`reads/taste-leaderboard.json`, revision `t4st-r3v`, category `overall`)
  as evidence under the record-only `taste-evidence` key. The mapping is
  explicit: row `model-id-a (high)` to model-a at effort high, row
  `model-id-b (high)` to model-b at effort high, and row `model-id-c`, which
  carries no effort tag, stays effort unspecified and is never stored.

**Agent:** The leaderboard suggests band 8 for model-a and 5 for model-b.
Taste is yours to set.

**User:** model-a taste 6 - I prefer how it plans, whatever the leaderboard
says. model-b taste 5, as suggested.

**Agent:** And model-c? Its leaderboard row carries no effort tag, so it is
not stored as evidence. Have you used it enough to set a taste?

**User:** I have not used model-c enough; leave its taste unset.

### Above-cap figure recorded

model-b's engines figure was measured at effort `xhigh`, above its
`maxEffort` of `high`. It is recorded under the record-only
`engines-above-cap` key with its measured effort, no feed lists that key,
and it never feeds a rating. With no eligible figure at or below the cap,
model-b's coding rating stays absent; the user declines an override. In the
proposal it is shown apart from the figures that feed ratings.

### Shared task floors

The registry being built has no tasks yet, and floors are global in `tasks`:
every profile, including the implicit `default`, gets them. The builder
asks:

**Agent:** The implement task needs floors, and floors are global: every
profile, including the implicit `default`, gets them. What minimums should
it have per stakes level?

**User:** Low coding 6 taste 4, normal coding 7 taste 4, high coding 8
taste 5.

**Agent:** Suggestion: rank coding then taste, and effort high - coding work
on this pool runs at high effort. Approve those?

**User:** Approved.

### Gap decisions

**Agent:** The implement task at high stakes wants coding 8 and taste 5
together. model-c reaches coding 8 but carries no taste rating; model-a has
taste 6 but coding 7. They do not clear together. I can hand-set model-c's
taste at 5 or above, which fills the high-stakes need, look for another
model, or you accept a coding ceiling of 7. My recommendation: accept the
ceiling - it keeps the set inside your budget.

**User:** Accept coding 7. High-stakes work can wait for a wider budget.

Recorded on the profile: `{ "rating": "coding", "accepts": 7, "reason":
"High-stakes coding 8 sits outside this budget; the set reaches coding 7." }`.

## The proposal

The builder shows the whole proposal in one place:

1. Membership, grouped by platform in the user's order for reading:
   `model-a@harness-x` (platform-a), `model-c@harness-z/aggregator-a`
   (aggregator-a), then `model-b@harness-y/provider-2` (platform-b, at the
   position you gave, after aggregator-a). Each model here has one route, so
   there is no route order to write; the label order above carries no
   ranking.
2. Shared fact changes: models model-a, model-b, model-c with their routes,
   each route's `hosted` written from evidence (the subscription service and
   the aggregator are hosted, so every route is `hosted: true`); ratings
   coding and taste; capability browser; meter plan-a, no fields;
   calibration with the four benchmark keys; the router section with
   `router.rank` coding then taste; the implement task with floors low
   coding 6 taste 4, normal coding 7 taste 4, high coding 8 taste 5, rank
   coding then taste, effort high. Tasks and floors apply to every profile,
   including the implicit `default`.
3. The ratings and bands above, shown for approval; record-only evidence
   (the above-cap figure and the taste rows) apart from the feeding
   figures.
4. The accepted coding-7 gap with its reason.

**User:** Approved. Write it.

## The checks

The builder writes the shared facts, the profile, and everything the rating
prompt's Steps 2 to 4 produced, then runs both checks. The registry as first
approved is kept
beside this README as `registry-before-rebuild.json`, and the lines below
are the checks' output for that file:

```console
$ model-registry check --registry registry-before-rebuild.json
{"format":1,"digest":"sha256:d4ec02aedf136e326cb57be3d22493aa182e11d52e0b65d7d43c315340291dbb","path":".../examples/profile-walkthrough/registry-before-rebuild.json"}
$ model-router check --registry registry-before-rebuild.json
{"configPath":null,"registryDigest":"sha256:d4ec02aedf136e326cb57be3d22493aa182e11d52e0b65d7d43c315340291dbb","registryPath":".../examples/profile-walkthrough/registry-before-rebuild.json","warnings":[{"code":"profile-gap-unrecorded","field":"$[\"tasks\"][\"implement\"][\"minimums\"][\"high\"][\"coding\"]","message":"profile \"default\", task \"implement\", stakes \"high\": the requirements are reachable only through different routes; no single route clears them together.","fix":"Declare \"default\" in profiles with gap record {\"rating\":\"coding\",\"accepts\":7,\"reason\":\"<why>\"}, or add a route that fills it."},{"code":"profile-gap-unrecorded","field":"$[\"tasks\"][\"implement\"][\"minimums\"][\"high\"][\"taste\"]","message":"profile \"default\", task \"implement\", stakes \"high\": the requirements are reachable only through different routes; no single route clears them together.","fix":"Rate a model in the registry for \"taste\", or add a route that fills it."}]}
```

Both exit 0. The reported `path` and `registryPath` match the written file.
The router check reports two warnings on the implicit `default` profile: at
implement, high stakes, no single route clears coding 8 and taste 5
together.

**Agent:** The checks pass, with two warnings on the implicit `default`
profile: implement at high stakes has no route reaching coding 8 and taste 5
together. You can add a filling route, declare `default` with a gap record,
or leave `default` implicit - the check passes and the warnings stay. My
recommendation: leave it implicit; builder-pool already records the coding-7
ceiling you accepted.

**User:** Leave `default` implicit.

## The rebuild

On 2026-11-02 the user asks to rebuild builder-pool. The builder re-reads
every source the build used:

- The harness-x read matches `lists/platform-a-harness.json`. No diff.
- The harness-y read matches `lists/platform-b-harness.json`. No diff.
- The catalog read at the same pinned revision `r3v-0c4t` matches
  `lists/catalog.json`. No diff.
- The aggregator-a read differs from its snapshot.

The builder shows the diff for approval:

```text
rebuild diff - aggregator-a (lists/aggregator-a.json)
removed: model-id-c
added: model-id-f
renamed: none
```

No source carries a rename notice, so the diff reports added and removed ids
only.

**User:** Approved - replace the snapshot.

The snapshot is replaced with the fresh passing set (`model-id-f`, read
2026-11-02; `model-id-e` still above the ceiling).

### The removal flag

The builder flags `model-c@harness-z/aggregator-a`: its model left the
aggregator, so the route is flagged for removal from the profile, never
silently removed.

**Agent:** model-c left aggregator-a. I can keep the route (it would sit on
a platform that no longer offers it), remove it from builder-pool, or swap
in model-id-f. My recommendation: remove the route; the accepted coding-7
gap already covers the high-stakes work, and model-id-f is unrated.

**User:** Remove it from builder-pool. Leave model-id-f out for now; note it
as a candidate.

**Agent:** Revised proposal: the route also leaves the shared registry,
because its platform no longer offers it. model-c, its route and its two
figures go; builder-pool keeps its accepted coding-7 gap; model-id-f stays
out. The effect on `default`: one coding warning remains, since model-a
reaches coding 7, and the taste warning from the first build leaves with
model-c. Approve the revised proposal before I write?

**User:** Approved. Write it.

The route leaves the profile and the registry; model-c's figures leave with
it. The pinned reads in `reads/` are unchanged, so the approved bands stand.

## Final state

`registry.json` holds model-a and model-b, the builder-pool profile with its
accepted coding-7 gap, and the router and tasks sections. Both checks run
again after the edit:

```console
$ model-registry check --registry registry.json
{"format":1,"digest":"sha256:7fe16b373819b83744bbbcaa2b6f6ab6fd28f0ff22ea196d597a7869a4c5af72","path":".../examples/profile-walkthrough/registry.json"}
$ model-router check --registry registry.json
{"configPath":null,"registryDigest":"sha256:7fe16b373819b83744bbbcaa2b6f6ab6fd28f0ff22ea196d597a7869a4c5af72","registryPath":".../examples/profile-walkthrough/registry.json","warnings":[{"code":"profile-gap-unrecorded","field":"$[\"tasks\"][\"implement\"][\"minimums\"][\"high\"][\"coding\"]","message":"profile \"default\", task \"implement\", stakes \"high\": no route in profile \"default\" reaches coding 8 (best 7).","fix":"Declare \"default\" in profiles with gap record {\"rating\":\"coding\",\"accepts\":7,\"reason\":\"<why>\"}, or add a route that fills it."}]}
```

Both exit 0. The declared builder-pool profile has no findings at any stakes
level: model-a clears the coding floor, capped at 7 by the accepted gap,
together with the taste floor. The one warning belongs to the implicit
`default` profile, which has no gap record: it was there from the first
build, first as two findings - coding and taste - and now, after the
rebuild, as one coding finding. The check passes either way: the declared
profile is what the build committed to.

**Agent:** Keep `default` implicit?

**User:** Yes, keep it implicit.
