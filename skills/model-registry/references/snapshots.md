# Model list snapshots and rebuilds

Load this file when a path saves a model list read, or re-reads one to
rebuild. Every model list read runs as a local command on the user's
machine, as the Discovery reads in `references/build-profile.md` describe.

## Snapshots

Save every model list read the build uses as one JSON snapshot per source,
in `lists/` beside the target registry file. Name each file after the public
platform and method, for example `platform-a-harness.json`. Filenames use
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

Done when each model list source the build used has one snapshot, and the
aggregator's snapshot records its narrowing.

## Rebuilds and diffs

Run this section only when `lists/` already holds snapshots for the target;
a new registry has none, and its first build skips it.

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

New ids an approved diff adds are candidates: they run through the Discovery
reads, Model effort limits and Rating handoff in
`references/build-profile.md` before they join a profile.

Done when every model list source is re-read, each differing snapshot is
replaced behind an approved diff, and each departed model's route is flagged.
