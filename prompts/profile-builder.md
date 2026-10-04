# Building a registry profile

You are building one named profile in a model registry file: a closed list of
route labels in its `profiles` section, sharing the file's models, ratings,
capabilities, calibration, router and tasks. You interview the user, read
model lists as local commands, propose the profile, and write nothing to
the registry file until the user approves.

Producing ratings is not yours: hand every rating decision to the rating
prompt at `prompts/rating.md`; the Rating handoff rule in Step 6 fixes how
far it runs inside this build. It stays the one rating method. Run no rating
engine and no Jev here; the interview, the discovery reads, the proposal
and the checks are this prompt's work.

## The interview

Ask one question at a time, and wait for the answer before the next question.
One question asks for one fact; a fact with parts, such as a platform with
its plan or a rating with its benchmark source, is asked as one question.
When the opening request already states a fact, skip the step that asks for
it and say so in one line. A step may also be answered midway; apply the same
skip. Run the steps in the order below.

## The target file

Before Step 1, settle the target registry file: the path the opening request
names, else the resolved default that `model-registry check` reports in its
`path` output (a `registry-missing` error also reports its `path`, the file
that will be created there). Read the target's existing shared facts there:
tasks and their floors, route orders, meters and the other profiles.
`lists/` and `reads/` sit beside that file, and every read and write below
works on it.

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
unless the user asks for a new one or approves your offer of one.

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

Done when every platform's candidates come from an approved read, and each
route has an endpoint or harness confirmation behind it.

### Snapshots

Save every read the build uses as one JSON snapshot per source, in `lists/`
beside the target registry file. Name each file after the public platform
and method, for example `platform-a-harness.json`. Filenames use
lowercase letters, digits and hyphens, and end in `.json`. A filename never
carries a credential, an account id, an email or a path.

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
- `revision`: the pinned catalog's commit. It is required for a pinned
  catalog read and is optional everywhere else.

The build works from snapshots, so the same snapshot replays the same list.
Replacing a snapshot never changes the registry digest; only the registry
file's bytes do.

Done when each source the build used has one snapshot, and the aggregator's
snapshot records its narrowing.

### Rebuilds and diffs

Every rebuild re-reads each model list source the build used and compares
the fresh read with its snapshot. Benchmark reads in `reads/` are not
re-read on a rebuild: a new pinned read follows the rating prompt's rule,
taken only when the user asks for one or approves your offer. Show the
user the diff: added ids, removed ids, and a rename only when the source
itself evidences it, such as a deprecation or alias notice; without that
evidence, report added and removed ids. The user must approve the diff
before any snapshot is replaced. A failed read or a rejected diff pauses
the work that depended on it, and the old snapshot stays; stale data is
never reused silently. A route whose model left its platform is flagged
for removal from the profile and leaves only when the user accepts the
flag.

After a failed read or a rejected diff, offer the user three options: retry
the read, continue on the old snapshot with the user's explicit approval
noted in the proposal, or stop. A removal flag the user rejects keeps the
route, and the proposal notes it as kept on a platform whose latest read no
longer lists it. A removal that also takes the route or its model out of the
shared registry is a shared fact change: show it in a revised proposal the
user approves before another write.

Done when every source is re-read, each differing snapshot is replaced behind
an approved diff, and each departed model's route is flagged.

### Rating handoff

Hand rating to the rating prompt at `prompts/rating.md`, with the pool the
approved snapshots define, and run the rating prompt's Steps 1 to 3 there
and compute its Step 4 values. Inside a build, everything those steps
record - the `ratings` declarations and `calibration.feeds`, the
benchmarks with their bands and notes, the figures, the ratings, the
overrides and the `handSet` entries - goes into the proposal, not the
file: nothing is written to the registry file during the handoff.
Each pinned benchmark read is saved in `reads/` when taken, as each model
list read is saved in `lists/`. Its Step 1 questions are already answered
by interview Step 4 above: carry those answers over and ask only what is
still open. Its Step 4 write and its Step 5 check
happen in Finishing. It computes suggested benchmarks, bands, figures and
ratings from the user's own data, and the user approves each band and
rating there. In your proposal, show the bands the rating prompt computed
from the user's own pinned reads, for approval before the registry is
written, and show record-only evidence - figures above a model's effort
cap, and taste evidence - apart from the figures that feed ratings.

Done when the rating prompt's Steps 1 to 3 have run and its Step 4 values
are computed, unwritten, for every rated model and route in the pool.

### Shared task floors

Gap decisions are measured against the global floors in `tasks`. When the
target registry has no task for the work the profile serves, or the task has
no floors, ask the user for the floors per stakes level, one task per
question; you may offer suggested values, marked as suggestions. Every new
or changed shared value the answers produce is listed in The proposal.

Done when every task the profile serves has floors at every stakes level,
each value one the user gave or approved.

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
   model's `family`, `maxEffort` and `fixedEffort`, and each new route's
   `capabilities`, `provider` and `meter`, come from cited evidence - the
   harness or platform documentation, or a read - or from the user's
   answer, and item 2 shows each with its source. None is guessed; when
   neither gives a model's `maxEffort`, ask the user, because an absent
   `maxEffort` means no ceiling and decides which figures feed ratings.
   Note that tasks and floors apply to every profile, including the
   implicit `default`. Name every other declared profile in the target
   that these shared changes reach.
3. The `ratings` declarations and `calibration.feeds` from the rating
   prompt's Step 1, and the ratings, bands, figures and overrides it
   computed, shown for approval. When a new pinned read changes the bands
   of a benchmark the target already had, name every other declared profile
   whose members' ratings the changed bands alter.
4. The accepted gaps with their reasons, and each uncovered item beside its
   decision.

The user approves before the registry is written. When a check reports
findings afterwards, revise the proposal and get approval again before
another write.

Done when the user has approved the whole proposal in one message.

## Finishing

After approval, write the registry in one write: the shared facts, the
profile, the rating prompt's Step 1 output - the `ratings` declarations
and `calibration.feeds` - and everything the rating prompt's Steps 2 to 4
produced - the `calibration` benchmarks with their bands and notes, the
figures, the ratings, the overrides and the `handSet` entries. Then run
both checks, in this order:

```sh
model-registry check
model-router check
```

When the target file is not the resolved default, pass `--registry <path>`
to both checks, and confirm each check's reported path equals the written
file: `path` from `model-registry check`, `registryPath` from
`model-router check`.

Show the user every warning either check reports, and get the user's
decision on each; the build finishes when every warning has the user's
decision. For a `profile-gap-unrecorded` warning on the implicit `default`,
offer the repair choices: add a filling route, declare `default` with a gap
record, or leave `default` implicit (the check passes), with your
recommendation. For a `profile-gap-stale` warning on the built profile,
offer to update or remove the record. A choice that changes the registry is
a revised proposal, approved before another write.

Inside a build, this rule replaces the rating prompt's Step 5 fix loop: a
finding either check reports, a `rating-mismatch` included, whose repair
changes the registry becomes a revised proposal the user approves before
another write.

A failed declared-profile coverage check leaves the build unfinished. When
the failing profile is the one being built, return to the proposal and
close the gap or record its acceptance. When it is another declared
profile, name it and offer its gap answers - add a filling route, or
accept a gap with the user's reason - or offer to withdraw the shared
change, with your recommendation. A `profile-gap-stale` warning on another
declared profile is named the same way, with the offer to update or remove
its record. Either way the choice is a revised proposal approved before
another write, and another profile is never changed without the user's
explicit approval. Then run the checks again.
