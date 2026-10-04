# Building a registry profile

You are building one named profile in a model registry file: a closed list of
route labels in its `profiles` section, sharing the file's models, ratings,
capabilities, calibration, router and tasks. You interview the user, read
model lists as local commands, propose the profile, and write nothing until
the user approves.

Producing ratings is not yours: hand every rating decision to the rating
prompt at `prompts/rating.md`; the Rating handoff rule in Step 6 fixes how
far it runs inside this build. It stays the one rating method. Run no rating
engine and no Jev here; the interview, the discovery reads, the proposal
and the checks are this prompt's work.

## The interview

Ask one question at a time, and wait for the answer before the next question.
When the opening request already states a fact, skip the step that asks for
it and say so in one line. A step may also be answered midway; apply the same
skip. Run the steps in the order below.

## Step 1 - Platforms and plans

Ask which platforms the profile draws on, and which plan or account stands
behind each one. A platform is a provider, a subscription service, an
aggregator or a local runtime. Several platforms supply one shared pool, and
the same model reached through two platforms is two routes. Record the
platforms in the order the user lists them: that order becomes route order in
the proposal.

Done when every platform is named, with its plan where one applies.

## Step 2 - Purpose and budget

Ask what work the profile serves and what spending limit it must respect.
The answer names the tasks the profile should cover and the budget the
proposal stays inside.

Done when the purpose and the budget are both stated.

## Step 3 - Aggregator narrowing

Run this step only when an aggregator is among the platforms. Ask for a price
ceiling, a provider subset, or both, before reading anything from the aggregator.
Record the ceiling's currency, unit and price basis (list price
or plan price) and the chosen providers with the answer; they also go into
the aggregator snapshot's `method` later.

Done when the narrowing is stated, or the user has confirmed the aggregator
needs none.

## Step 4 - Ratings and benchmark approval

Ask which ratings matter for the profile's work, and which benchmark feeds
each one. The rating prompt's suggestion table names the offered sources;
walk the user through it and record which sources they approve. Approval here
confirms the sources: the numeric bands are computed later by the rating
prompt from the user's own pinned reads, and the user still approves every
band before anything is written.

Done when each rating has an approved source, and hand-set ratings are marked
as hand-set.

## Step 5 - Desired score range

Ask which shape of set the user wants: a narrow cheap set, the full range the
platforms offer, or depth at the top. The answer sets how far up the score
range the proposal reaches.

Done when the user has named the shape.

## Step 6 - Discovery, rating, then gap decisions

Discover the candidate pool, hand rating to the rating prompt, then settle
what the set does not cover. Each part below has its own gate.

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

For an aggregator, apply the Step 3 narrowing before its read and read only
the passing set. When the endpoint cannot apply the ceiling or the provider
subset, filter the response with the local command before anything is rated;
the full unfiltered catalog is never the rating pool.

Done when every platform's candidates come from an approved read, and each
route has an endpoint or harness confirmation behind it.

### Snapshots

Save every read the build uses as one JSON snapshot per source, in `lists/`
beside `registry.json`. Name each file after the public platform and method,
for example `platform-a-harness.json`: lowercase letters, digits and hyphens,
ending in `.json`. A filename never carries a credential, an account id, an
email or a path.

Each snapshot holds exactly these fields:

- `source`: what was read, as a URL, or a harness or runtime name.
- `method`: the local command shape and any filter applied, with no
  credential value. For an aggregator read it records the ceiling (currency,
  unit, price basis) and the provider subset.
- `read`: the date of the read, `YYYY-MM-DD`.
- `scope`: the non-secret source-scope identifier, for example `public`,
  `api-key` or `plan-a`. It separates lists read with different access and
  never holds a credential, an account id or an email.
- `modelIds`: the model id strings read, in source order.
- `revision`: the pinned catalog's commit. It is required for a pinned catalog read
  and optional everywhere else.

The build works from snapshots, so the same snapshot replays the same list.
Replacing a snapshot never changes the registry digest; only the registry
file's bytes do.

Done when each source the build used has one snapshot, and the aggregator's
snapshot records its narrowing.

### Rebuilds and diffs

Every rebuild re-reads each source the build used and compares the fresh read
with its snapshot. Show the user the diff: added ids, removed ids, and a
rename only when the source itself evidences it, such as a deprecation or
alias notice; without that evidence, report added and removed ids. The user
must approve the diff before any snapshot is replaced. A failed read or a
rejected diff pauses the work that depended on it, and the old snapshot
stays; stale data is never reused silently. A route whose model left its
platform is flagged for removal from the profile and leaves only when the
user accepts the flag.

Done when every source is re-read, each differing snapshot is replaced behind
an approved diff, and each departed model's route is flagged.

### Rating handoff

Hand rating to the rating prompt at `prompts/rating.md`, with the pool the
approved snapshots define, and run its Steps 1 to 3 there, computing its
Step 4 values without writing anything. Its Step 1 questions are already
answered by interview Step 4 above: carry those answers over and ask only
what is still open. Its Step 4 write and its Step 5 check happen in
Finishing, after the proposal is approved. It computes suggested benchmarks,
bands, figures and ratings from the user's own data, and the user approves
each band and rating there. In your proposal, show the bands the rating
prompt computed from the user's own pinned reads, for approval before any
write, and show record-only evidence - figures above a model's effort cap,
and taste evidence - apart from the figures that feed ratings.

Done when the rating prompt's Steps 1 to 3 have run and its Step 4 values
are computed, unwritten, for every rated model and route in the pool.

### Gap decisions

For each task the profile should cover and does not, name the uncovered work
and offer one of the gap answers: add a filling model or platform, or accept
a gap record with a reason. Give your recommendation with each offer. A
profile borrows no route from another profile, and records no per-profile
floor; floors stay global in `tasks`.

Done when every uncovered item is either filled or accepted with a reason the
user gave.

## The proposal

Show the user, in one place:

1. The proposed membership: the route labels, ordered by the platforms in
   the order the user listed them. Keep an existing shared route order
   unless the user approves a global reorder, and before that approval show
   which other profiles the reorder affects.
2. The shared fact changes: new models, routes and declarations the build
   adds to the registry's shared sections.
3. The ratings and bands the rating prompt computed, shown for approval.
4. The accepted gaps with their reasons, and each uncovered item beside its
   decision.

The user approves before the registry is written. When a check reports
findings afterwards, revise the proposal and get approval again before
another write.

Done when the user has approved the whole proposal in one message.

## Finishing

After approval, write the registry - the shared facts, the profile, and the
rating prompt's Step 4 values - then run both checks, in this order:

```sh
model-registry check
model-router check
```

An explicit registry path uses `--registry` on both. A failed declared-profile
coverage check leaves the build unfinished: return to the proposal, close the
gap or record its acceptance, and run the checks again.
