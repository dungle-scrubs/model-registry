# Rating a model registry

You are filling in the ratings of one model registry file. A rating is an
integer from 1 to 10, higher is better. `cost` is the reserved route-level
rating: higher means cheaper. Every other rating name is declared in the
registry's `ratings` section. The `calibration` section records how each
rating was produced: the benchmarks and their band tables, the figures read
from each source, and the overrides that let a written value disagree with
the table.

Work through the five steps below in order. Never invent a figure, a band
or a rating the user did not give you: the registry must agree with its own
table or the loader rejects it.

## Step 1 - ask which ratings, benchmarks and models matter

Ask the user, one question at a time:

1. Which ratings matter for this registry? Each one must be declared in
   `ratings` with a one-line description.
2. Which benchmarks feed each rating? The benchmark's name goes in
   `calibration.feeds` under the rating it feeds; for routes' `cost` the
   feed is named `cost`. The loader never fetches data; you read each
   figure from the user's pinned read of the source and record it in
   `calibration.figures`.
3. Which models should be rated, and which routes carry a cost?

When the user has no source in mind, offer a suggestion from this table.
Every suggestion is offered, never adopted without the user's approval:

| Rating | Suggested evidence | Condition |
|---|---|---|
| `intelligence` | Artificial Analysis Intelligence Index | The user fetches the figures with their own key. |
| `coding` | Artificial Analysis Coding Index | The user fetches the figures with their own key. |
| Route `cost` | Artificial Analysis cost per task | The measured provider and effort match the route's; when either differs, write an override with a reason instead of using the figure. |
| Hand-set `taste` | Arena WebDev `overall` | Evidence and a suggested band while the user sets taste by hand; never a feed. |

The package ships no Artificial Analysis figures: a user fetches every
figure with their own key, for their own registry. Every benchmark read
runs as a local command on the user's machine, so no key ever reaches you.

## Step 2 - propose bands, show the ratings they give, wait for approval

For each benchmark, record:

- `source`: where the benchmark's figures come from, as a URL.
- `field`: the column the figures are read from.
- `version`: the identity of the pinned read the bands and figures come
  from: its revision, or its read date when the source has no revision.
  Bands the user edits or supplies belong to that same read.
- `direction`: `higher` when a larger figure is better, `lower` when a
  smaller figure is better.
- `bands`: an ordered list of `{ "at": <number>, "score": 1-10 }`. With
  `higher`, a figure at or above `at` takes `score`; with `lower`, at or
  below. The first band that matches wins.

Propose bands, computed with the decile method below, when a benchmark that
a feed lists has no bands, or when the user takes a new pinned read; show
the ratings those bands would give for each model and write nothing to the
registry until the user approves.
Take a new pinned read only when the user asks for one or approves your
offer of one. A record-only key that no feed lists keeps `bands: []` and
gets no band proposal. There are no default bands: the package ships none, and
the table is the user's own choice.

Compute every proposed band from the user's own pinned read of that
benchmark: a read the user made with their own key, at a recorded revision
or date, kept as one JSON file per read in `reads/` beside the registry
file, named `<source-name>-<version>-<read-date>.json` under the Pinned read
files rule below, holding the source, `version` (its revision or read date),
read date and every row read. The package ships no band numbers; this
method is all it ships.

The distribution is every row with a figure in that pinned read, not only
the models being rated. Sort the n figures worst to best by the benchmark's
`direction`: with `higher`, lower figures are worse; with `lower`, higher
figures are worse. The figure of rank r (1 = worst) sits in tenth
k = ceil(10 * r / n), and the band for score k has `at` set to the worst
figure in tenth k:

| Tenth of the pinned distribution, worst to best | Suggested score |
|---|---|
| Lowest tenth | 1 |
| Second tenth | 2 |
| Third tenth | 3 |
| Fourth tenth | 4 |
| Fifth tenth | 5 |
| Sixth tenth | 6 |
| Seventh tenth | 7 |
| Eighth tenth | 8 |
| Ninth tenth | 9 |
| Top tenth | 10 |

Write the bands best first, score 10 first. A tenth with no figure, from a
read shorter than ten rows, gives no band. When two bands share an `at`,
keep the higher score only. A figure worse than every pinned figure matches
no band: show that to the user and propose an override with a reason or a
fresh pinned read; never invent a band to cover it. Record the read identity
in the benchmark's `version` (its revision or read date) and the method in
its `notes`. The user approves every band before the registry is written.

## Step 3 - read and record figures

Every benchmark read runs as a local command on the user's machine: the
key stays in the local environment, you see the command shape and its
output, and you never ask for or receive a key. The pinned read itself is
that local command.

For each benchmark in each feed, read the figure for every rated model
and, for `cost`, every route that carries one, from the pinned read in
`reads/` whose source and read identity match the benchmark's `source`
and `version`, not from a fresh fetch. A read date alone does not
identify a read: several benchmarks can share one. Match each record-only
key by its own source and `version`, even when another benchmark shares
its source.

When no file in `reads/` matches a benchmark's `source` and `version` -
a registry rated before `reads/` existed - say so and offer a new pinned
read. On the user's yes, take it; Step 2 proposes bands again from that
read and that benchmark's figures are taken from the new read only: a model
or route the new read lacks keeps no figure from that benchmark. On a no,
record no new figure from that
benchmark and keep its existing figures and bands. A model or route left
without a figure or band from that benchmark gets no computed rating
from it unless the user writes an override with a reason.

Record each figure under `calibration.figures`, keyed by model key (or by
route label for `cost`), then by benchmark name, with:

- `value`: the figure as a finite number.
- `read`: the read date of that pinned read.
- `effort`: the effort level the figure was measured at, one of
  `low < medium < high < xhigh < max`.

Figures may name a model or route the registry does not declare; they are
checked for shape only and skipped by the rating check.

### Pinned read files

Each read is saved when taken, before registry approval. Reads are never
overwritten. Use `<source-name>-<version>-<read-date>.json`: the version
appears once when it is the read date, for example `engines-2026-10-06.json`.
Filenames use lowercase letters, digits and hyphens only before `.json`:
lowercase the version and replace every other character with a hyphen.
The source name is a short public name of the source, never a credential,
an account id, an email or a path. If a file of that name already exists,
this is the same read identity on the same date; do not save over it,
keep and use the existing read and say so.

A rejected proposal or rejected bands leave the registry unchanged; the
new read file stays in `reads/`. Remove an old read only after the user
approves and no benchmark in the registry matches it by source and
version, never before the registry write. You may offer removal, but
never do it unasked.

### New pinned reads

Whenever a benchmark takes a new pinned read - first bands, the user's
request, an approved offer, or the no-match yes branch - replace its
figures for every model and route in the registry that has one, not only
the rated set. Take every replacement from the new read; a subject it
lacks keeps no figure from that benchmark and gets no computed rating
from that benchmark unless the user writes an override with a reason.
Recompute every rating the benchmark feeds for every model and route in
the registry and show the values before the registry is written. The
proposal names every declared profile whose members' ratings move through
changed bands or figures, even when this prompt runs outside a build.

A record-only key sharing the source keeps its own `version`, figures and
read file. The proposal lists each such key and asks whether to move it
too. On yes, its `version` becomes the new read's identity and its figures
move by the same replacement rule. On no, it stays on its old read; that
read is still named and stays.

### Taste evidence from Arena WebDev `overall`

`taste` stays a hand-set rating: it lives in `calibration.handSet`, never in
`feeds`. Its suggested evidence is Arena WebDev `overall`, read from the
Hugging Face dataset `lmarena-ai/leaderboard-dataset` at a pinned revision,
not a scrape of the leaderboard site. Read category `overall` only; `webdev`
duplicates those rows, so pooling both counts the same evidence twice.
Declare one benchmark key that no feed lists (for example `taste-evidence`)
and put in its `notes`: the dataset revision, the category, the publication
date, the CC BY 4.0 attribution with a source link, and an explicit mapping
from each source row name to its model and effort, with enough row evidence
to distinguish duplicate names. A row that names an
effort may be stored as a figure under that key, with that effort. A row
with no effort tag stays "effort unspecified" in the mapping and is
never stored, because a figure needs an effort. Suggest a band for taste
with the same decile method over the user's pinned `overall` distribution;
the user still writes the rating by hand.

### Figures above a model's effort cap

A figure measured above a model's `maxEffort` keeps its measured `effort`
and never feeds the rating. Store it under a distinct benchmark key that no
feed lists, for example `engines-above-cap` beside `engines`, declared in
`calibration.benchmarks` like any other benchmark, so the eligible key can
feed while the above-cap key only records. When a rating has no eligible
figure at or below `maxEffort`, the written rating stays absent unless the
user writes an override with a reason. Show record-only figures apart from
the figures that feed ratings whenever you present them.

## Step 4 - write ratings, overrides and handSet entries

For each rating in `feeds`, the table computes each model's rating: score
every figure that has a band match, skip the missing figures, and take the
floor of the mean of the surviving scores. With no score left, the table
gives no value. Write exactly what the table gives.

When a written value must disagree with the table, or a route carries a
`cost` no figure can compute, add an entry to `calibration.overrides`
with `rating`, exactly one of `model` or `route` (use `route` for `cost`),
the written `value`, and a non-empty `reason`.

When a rating is written by hand rather than computed, add its name to
`calibration.handSet` and do not list it in `feeds`. A handSet rating
needs no override. A rating in `handSet` must not appear in `feeds`.

## Step 5 - run `model-registry check`

```sh
model-registry check
```

The check loads the registry through the loader's path order, validates
the schema and every reference, and compares each written rating with the
table the file itself stores. A `rating-mismatch` problem names the
written rating's field, the value the table gives (or that it gives none),
and the override that would allow the written value. Fix what it names and
re-run until the check exits 0.
