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
   figure from the source and record it in `calibration.figures`.
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
figure with their own key, for their own registry.

## Step 2 - propose bands, show the ratings they give, wait for approval

For each benchmark, read its table from the source and record:

- `source`: where the table came from, as a URL.
- `field`: the column the figures are read from.
- `version`: the version of the table the bands belong to.
- `direction`: `higher` when a larger figure is better, `lower` when a
  smaller figure is better.
- `bands`: an ordered list of `{ "at": <number>, "score": 1-10 }`. With
  `higher`, a figure at or above `at` takes `score`; with `lower`, at or
  below. The first band that matches wins.

When a benchmark has no table, or the source's published version differs
from the `version` the table records, propose bands computed with the decile
method below, show the user the ratings those bands would give for each
model, and write nothing until the user approves. There are no default bands:
the package ships none, and the table is the user's own choice.

Compute every proposed band from the user's own pinned read of the benchmark:
a read the user made with their own key, at a recorded revision or date,
kept beside the registry. The package ships no band numbers; this method is
all it ships.

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

For each benchmark in each feed, read the figure for every rated model
and, for `cost`, every route that carries one. Record each figure under
`calibration.figures`, keyed by model key (or by route label for `cost`),
then by benchmark name, with:

- `value`: the figure as a finite number.
- `read`: the date you read it.
- `effort`: the effort level the figure was measured at, one of
  `low < medium < high < xhigh < max`.

Figures may name a model or route the registry does not declare; they are
checked for shape only and skipped by the rating check.

### Taste evidence from Arena WebDev `overall`

`taste` stays a hand-set rating: it lives in `calibration.handSet`, never in
`feeds`. Its suggested evidence is Arena WebDev `overall`, read from the
Hugging Face dataset `lmarena-ai/leaderboard-dataset` at a pinned revision,
not a scrape of the leaderboard site. Read category `overall` only; `webdev`
duplicates those rows, so pooling both counts the same evidence twice.
Declare one benchmark key that no feed lists (for example `taste-evidence`)
and put in its `notes`: the dataset revision, the category, the publication
date, the CC BY 4.0 attribution with a source link, and an explicit mapping
from each source row name to its model and effort. A row that names an
effort may be stored as a figure under that key, with that effort. A row
with no effort tag stays "effort unspecified" in the mapping and is
never stored, because a figure needs an effort. Suggest a band for taste with the
same decile method over the user's pinned `overall` distribution; the user
still writes the rating by hand.

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
the schema and every reference, and compares each written rating with
the table the file itself stores. A `rating-mismatch` problem names the
written rating's field, the value the table gives (or that it gives none),
and the override that would allow the written value. Fix what it names and
re-run until the check exits 0.
