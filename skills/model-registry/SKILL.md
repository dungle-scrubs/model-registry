---
name: model-registry
description: "Create, extend and maintain a model registry file for model-router. Use when the user wants to create a model registry for the first time, add a platform or a model, build or extend a profile, record an accepted coverage gap, or refresh ratings from benchmarks. Interviews the user one question at a time, reads model lists and benchmarks as local commands, proposes every change for approval before writing, and validates the file with model-registry check and model-router check."
---

# Model registry

You create or maintain one model registry file for model-router: its models
and the routes that reach them, its tasks and their floors, its `router`
section, its ratings, and its named profiles, each a closed list of route
labels in its `profiles` section. You interview the user, read model lists
and benchmarks as local commands, propose the result, and write nothing to
the registry file until the user approves.

Producing ratings is not yours: hand every rating decision to the rating
prompt at `references/rating.md`; inside a build, the Rating handoff in
`references/build-profile.md` fixes how far it runs. It stays the one rating
method. Use it for every rating, and use no other rating tool or engine.

## Prerequisites

Node 22.14 or newer, and the two command-line tools this skill runs.

Choose one invocation before the first command, and use it for every command
in this skill and its references. When `model-registry --version` and
`model-router --version` both print a version, the tools are installed
globally: use them as they are. To install them globally:

```sh
npm install -g @dungle-scrubs/model-registry @dungle-scrubs/model-router
```

When the user does not want a global install, use the npx forms:

```sh
npx --yes --package=@dungle-scrubs/model-registry@latest model-registry check
npx --yes --package=@dungle-scrubs/model-router@latest model-router check
```

Everywhere below and in every reference, a command written as
`model-registry ...` or `model-router ...` means the chosen invocation with
the same arguments, including `--registry <path>`.

## The target file

Before the first step of any path, settle the target registry file: the path
the opening request names, else the resolved default. Run
`model-registry check`, with `--registry <path>` when the request names a
path; its `path` output is the target. A `registry-missing` error also
reports its `path`: the target does not exist yet, and the file will be
created there. When the target exists, read its shared facts: tasks
and their floors, route orders, meters and the other profiles. `lists/` and
`reads/` sit beside that file, and every read and write works on it.

## Choose the path

Pick the path that matches the request, then read and follow its reference.

| Request | Follow |
|---|---|
| No registry file at the target | `references/new-registry.md` |
| Build or extend a profile | `references/build-profile.md` |
| Add a platform or a model | `references/build-profile.md`, "Adding a platform or model" |
| Record an accepted coverage gap | `references/gaps.md`, "Recording a gap" |
| Refresh ratings only | `references/rating.md`, from its Step 1 |
| Re-read model lists, or rebuild | `references/snapshots.md` |

A narrow request - a platform, a model, a gap, a rating refresh - does not
run the full interview. Read the existing facts in the target first, and ask
only for what the request needs and the file does not already hold.

Load `references/snapshots.md` when a path saves or re-reads a model list,
and `references/gaps.md` when a task is uncovered or a check reports a
coverage finding.

## The interview

Ask one question at a time, and wait for the answer before the next question.
One question asks for one fact; a fact with parts, such as a platform with
its plan or a rating with its benchmark source, is asked as one question.
When the opening request already states a fact, skip the step that asks for
it and say so in one line. A step may also be answered midway; apply the same
skip. Run a path's steps in the order its reference gives.

## Approval

Every change to the registry file is shown to the user as a proposal first.
The user approves before the registry is written. When a check reports
findings afterwards, revise the proposal and get approval again before
another write. Saving a model list in `lists/` or a pinned read in `reads/`
is not a registry write.

## Finishing checks

Every path that writes the registry ends by running both checks, in this
order:

```sh
model-registry check
model-router check
```

When the target file is not the resolved default, pass `--registry <path>`
to both checks, and confirm each check's reported path equals the written
file: `path` from `model-registry check`, `registryPath` from
`model-router check`. Show the user every warning and failure either check
reports. Settle coverage findings and warnings under "Check findings" in
`references/gaps.md`; any other finding's repair is a revised proposal.
Run both checks again after every approved repair, until both exit 0 and
every warning has the user's decision.
