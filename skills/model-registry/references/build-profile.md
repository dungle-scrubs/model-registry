# Building a profile

You build or extend one named profile in the target registry file, with the
models, routes, tasks, ratings and shared facts it needs. The interview,
approval and finishing rules in `SKILL.md` apply throughout. A new registry
runs these steps with the additions in `references/new-registry.md`.

## Adding a platform or model

A request to add a platform or a model, without a profile build, runs only
the parts below, for the new platform or model only:

1. Step 1 for the new platform, with its plan and its place in the platform
   order. Skip it when the request adds a model to a platform the registry
   already reaches.
2. Step 3 when the new platform is an aggregator.
3. Step 6's discovery reads, model effort limits and rating handoff, for the
   new routes and models. The rating handoff asks which declared ratings to
   compute for the new models; Step 4's facts already in the file are reused.
4. The proposal, items 2 and 3. Profile membership changes only when the user
   names a profile; then items 1 and 4 apply to that profile.
5. Finishing.

Skip Steps 2, 4 and 5 unless a fact they ask for is missing from the file.

## Step 1 - Platforms and plans

Ask which platforms the profile draws on, and which plan or account stands
behind each one. A platform is a provider, a subscription service, an
aggregator or a local runtime. Several platforms supply one shared pool, and
the same model reached through two platforms is two routes. Record the
platforms in the order the user lists them: that order sets the order of
each model's `routes` array, as The proposal writes it.

Done when every platform is named, with its plan where one applies.

## Step 2 - Purpose and budget

Ask what work the profile serves and what spending limit it must respect.
The answer names the tasks the profile should cover and the budget the
proposal stays inside.

Done when the purpose and the budget are both stated.

## Step 3 - Aggregator narrowing

Run this step only when an aggregator is among the platforms. The user must
give a price ceiling, a provider subset, or both before reading anything
from the aggregator. Record the ceiling's currency, unit and price basis
(list price or plan price) and the chosen providers with the answer; they
also go into the aggregator snapshot's `method` later. When the user
declines both, the aggregator is not read and adds no candidates; say why
in one line in the proposal.

Done when the narrowing is stated, or the aggregator is left out.

## Step 4 - Ratings and benchmark approval

Ask which ratings matter for the profile's work, and which benchmark feeds
each one. The rating prompt's suggestion table names the offered sources;
walk the user through it and record which sources they approve. Approval
here confirms the sources: the numeric bands are computed later by the
rating prompt from the user's own pinned reads, and the user still approves
every band before the registry is written. Approving a source whose
benchmark has no matching pinned read in `reads/` also approves taking its
pinned read during the rating handoff; an existing matching read is reused
unless the user asks for a new one or approves your offer of one. Use the
rating prompt's Step 3 source-and-version match rule. A Step 4 approval
with no matching read is the yes to that offer; say so in one line.

Done when each rating has an approved source, and hand-set ratings are marked
as hand-set.

## Step 5 - Desired score range

Ask which shape of set the user wants: a narrow cheap set, the full range the
platforms offer, or depth at the top. The answer sets how far up the score
range the proposal reaches.

Done when the user has named the shape.

## Step 6 - Discovery, rating, then gap decisions

Discover the candidate pool, settle each new model's effort limits, hand
rating to the rating prompt, then settle what the set does not cover. Each
part below has its own gate.

### Discovery reads

Every model list read runs as a local command on the user's machine,
including reads of public sources, so no credential ever enters this
conversation. Before using a source, read that source's current official
documentation for the command and its output shape; sources differ, and an
assumed common schema fails silently. When a read needs authentication, the
local environment supplies it: you see the command's public shape and its
output, nothing else.

Weigh the evidence in this order:

| Evidence | Use and limit |
|---|---|
| Harness list | Closest to the route's accepted model ids; the preferred confirmation. |
| Platform endpoint | Names the platform's models; an API list does not establish that the user's plan includes them. |
| Local runtime list | Reports the models installed locally, not everything reachable elsewhere. |
| Pinned catalog | models.dev, read at a recorded revision. It suggests platforms and models; it never admits a route. |
| Research | Last resort: cited pages, the date read, the method stated, and user approval. It is not proof a harness reaches a model. |

A model becomes a route only after an endpoint or harness read confirms the
platform offers it. When an API list and a harness list conflict, trust the
harness acceptance that matches the access scope, together with evidence for
the user's plan; an API catalog is not subscription proof. A model the
harness cannot reach stays out of the pool.

When the catalog suggests a platform the user did not list, ask about it as
one question: whether the user has access to it, on which plan or account,
and where it sits in the platform order. Only on the user's yes does it join
the platform list, at the position the user gives, with its plan or account
facts (Step 1) and the Step 3 narrowing when it is an aggregator; an
endpoint or harness read then confirms its models. Without a yes it is not
read and supplies no route.

For an aggregator, apply the Step 3 narrowing before its read and read only
the passing set. When the endpoint cannot apply the ceiling or the provider
subset, filter the response with the local command before anything is rated;
the full unfiltered catalog is never the rating pool.

Save every model list read as a snapshot, and run every rebuild, under
`references/snapshots.md`.

Done when every platform's candidates come from an approved read, each
route has an endpoint or harness confirmation behind it, and each read the
build uses has its snapshot.

### Model effort limits

Before the rating handoff, settle each new model's `maxEffort` and
`fixedEffort` from cited evidence - the harness or platform documentation,
or a read - or from the user's answer, and record the source of each. None
is guessed; when neither gives a model's `maxEffort`, ask the user, because
an absent `maxEffort` means no ceiling and decides which figures feed
ratings. An existing model keeps the limits the file already holds unless
the user approves a change.

Done when every new model in the pool has its effort limits settled, each
with its source, or the user has confirmed it has none.

### Rating handoff

Hand rating to the rating prompt at `references/rating.md`, with the pool the
approved snapshots define and the effort limits settled above, and run the
rating prompt's Steps 1 to 3 there and compute its Step 4 values. Inside a
build, everything those steps record - the `ratings` declarations and
`calibration.feeds`, the benchmarks with their bands and notes, the
figures, the ratings, the overrides and the `handSet` entries - goes into
the proposal, not the file: nothing is written to the registry file during
the handoff. Until the write, "the registry" in the rating prompt means the
draft: the target's existing facts plus the pool and every new fact the
build has gathered. Each pinned benchmark read is saved in `reads/` when
taken, as each model list read is saved in `lists/`. Reads are never
overwritten: use `<source-name>-<version>-<read-date>.json` under the rating
prompt's Pinned read files rule, including its name-clash handling. Its
Step 1 questions are already answered by interview Step 4 above: carry
those answers over and ask only what is still open. Its Step 4 write and its
Step 5 check happen in Finishing. It computes suggested benchmarks, bands,
figures and ratings from the user's own data, and the user approves each
band and rating there. In your proposal, show the bands the rating prompt
computed from the user's own pinned reads, for approval before the registry
is written, and show record-only evidence - figures above a model's effort
cap, and taste evidence - apart from the figures that feed ratings.

For a new pinned read, replace every figure under that benchmark and
recompute every rating it feeds for every model and route in the registry,
not only the pool, following the rating prompt's New pinned reads rule.
A record-only key sharing the source keeps its own pinned read until the
user approves moving it too.

Done when the rating prompt's Steps 1 to 3 have run and its Step 4 values
are computed, unwritten, for every rated model and route in the pool, and
for every model and route in the registry affected by a new pinned read.

### Shared task floors

Gap decisions are measured against the global floors in `tasks`. When the
target registry has no task for the work the profile serves, or the task has
no floors, ask the user for the floors per stakes level, one task per
question; you may offer suggested values, marked as suggestions. A new task
also needs its one-line `description` and its `rank`, as
`references/new-registry.md` lists. Every new or changed shared value the
answers produce is listed in The proposal.

Done when every task the profile serves has floors at every stakes level,
each value one the user gave or approved.

### Gap decisions

For each task the profile should cover and does not, name the uncovered work
and offer the gap answers `references/gaps.md` allows for it: add a filling
model or platform, accept a gap record with a reason when a valid record can
express it, or obtain the missing rating. Give your recommendation with each
offer. A profile borrows no route from another profile, and records no
per-profile floor; floors stay global in `tasks`.

Done when every uncovered item is either filled or accepted with a reason the
user gave.

## The proposal

Show the user, in one place:

1. The proposed membership: the route labels, which may be grouped by
   platform in the user's order for reading; the label list carries no
   ranking. The order that matters is each model's `routes` array, set in
   Step 1 by the order the user listed the platforms, which breaks ties on
   equal cost. Keep an existing model's `routes` order unless the user
   approves a global reorder, and before that approval show which other
   profiles the reorder affects.
2. The shared fact changes: every new or changed shared value the build adds
   to the registry's shared sections - new models and routes; `tasks` with
   their floors, `rank` and `effort`; `router`; meters and their fields.
   Each new route's `hosted` (and `privacyEligible` when set) is written
   from evidence the user confirms: a local runtime on the user's machine is
   not hosted; a provider, subscription service or aggregator is. Each new
   model's `family`, and the `maxEffort` and `fixedEffort` settled under
   Model effort limits, and each new route's `capabilities`, `provider` and
   `meter`, come from cited evidence - the harness or platform
   documentation, or a read - or from the user's answer, and item 2 shows
   each with its source. None is guessed. Note that tasks and floors apply
   to every profile, including the implicit `default`. Name every other
   declared profile in the target that these shared changes reach.
3. The `ratings` declarations and `calibration.feeds` from the rating
   prompt's Step 1, and the ratings, bands, figures and overrides it
   computed, shown for approval. For a new pinned read, show every recomputed
   rating before the write and name every declared profile whose members'
   ratings move through changed bands or figures. List every record-only
   key sharing that source and ask whether to move it too. On yes, move
   its `version` and figures by the rating prompt's rule; on no, keep its
   old `version`, figures and read file.
4. The accepted gaps with their reasons, and each uncovered item beside its
   decision.

The user approves before the registry is written. When a check reports
findings afterwards, revise the proposal and get approval again before
another write.

A rejected proposal or rejected bands leave the registry unchanged; the
new read file stays in `reads/`.

Done when the user has approved the whole proposal in one message.

## Finishing

After approval, write the registry in one write: the shared facts, the
profile, the rating prompt's Step 1 output - the `ratings` declarations
and `calibration.feeds` - and everything the rating prompt's Steps 2 to 4
produced - the `calibration` benchmarks with their bands and notes, the
figures, the ratings, the overrides and the `handSet` entries. Then run the
finishing checks in `SKILL.md` against the written file.

Remove an old read only after the user approves its removal and no
benchmark in the registry matches it by source and version, never before
the registry write. After the registry write you may offer removal; never
remove it unasked.

Inside a build, this rule replaces the rating prompt's Step 5 fix loop: a
finding either check reports, a `rating-mismatch` included, whose repair
changes the registry becomes a revised proposal the user approves before
another write. Coverage findings and warnings follow "Check findings" in
`references/gaps.md`; when the failing profile is the one being built,
return to the proposal and close the gap or record its acceptance.
