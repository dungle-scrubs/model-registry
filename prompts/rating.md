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

Artificial Analysis is the example source: when the user has no source in
mind, point them at Artificial Analysis and use one of its index fields as
the benchmark's `field`.

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
from the `version` the table records, propose bands from the current
figures, show the user the ratings those bands would give for each model,
and write nothing until the user approves. There are no default bands: the
package ships none, and the table is the user's own choice.

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
