---
number: 02
title: "Registry profiles and model list discovery"
type: feature
status: Accepted
author: "Kevin Frilot"
date: 2026-10-01
---

# RFC-02: Registry profiles and model list discovery

## Abstract

An operator needs several sets of routes in one registry without copying
shared declarations or ratings. This RFC adds named profiles and accepted
gap records to registry format 1, and specifies profile selection and a
coverage check in `model-router`. It also specifies a public profile builder
prompt that calls the rating prompt, discovers model lists through local
commands, and builds from approved snapshots. RFC-01 ships unchanged;
profiles follow its 1.0.0 releases, and this draft includes the decisions
made in the 2026-10-01 RFC-02 review.

Source: [The decision map][map], [Profile form][t49],
[Coverage check][t51], [Builder placement][t55] and [Discovery][t56];
Kevin, 2026-10-01, RFC-02 review.

## Introduction

### Problem

A second registry file already gives an operator a separate set of routes.
It duplicates shared declarations and gives no check that the set covers
the router's tasks. A set can miss a capability or fall below a rating
floor without the operator finding the gap until a query uses it.

Model lists introduce a separate problem. A live endpoint or harness list
can change during a day. An API list does not establish which models a
subscription includes, and a catalog entry does not establish that a
harness can reach the model.

Source: [Roadmap][roadmap], [Model list sources][t47] and
[Profile form][t49].

### What this RFC specifies

- An optional `profiles` section, shared model facts, accepted `gaps`,
  and an implicit `default` profile.
- The `profile` query field, CLI environment selection, graybox's
  `routing.profile`, and the profile recorded with a routing decision.
- Coverage checking for every profile in `model-router check` and gap
  warnings in answers.
- A public builder prompt, its interview and approval contract, and its
  use of the separate rating prompt.
- Model list discovery instructions, local snapshots, refresh diffs,
  the default catalog, and narrowing an aggregator's list.
- Suggested benchmarks and bands, Arena evidence for hand-set taste,
  and treatment of figures measured above a model's effort cap.
- The example registry, package release categories, and the precise
  changes to RFC-01.

Source: [The decision map][map] and its [13 resolved tickets][map].

### What this RFC does not cover

This RFC covers only the two roadmap entries, "Profiles: complete,
separate sets of models" and "Model list discovery". It does not specify
how graybox's interface displays a profile. It adds no discovery CLI,
provider adapter, runner adapter, rating engine, cross-profile fallback,
or profile-specific tasks or floors.

Source: [The decision map][map], [Gap answers][t50],
[Builder placement][t55] and [Discovery][t56].

### Where the decisions come from

This RFC renders the resolutions of issues #47 through #57, #59 and #60
on [Map: registry profiles and model list discovery][map]. It uses RFC-01
as the completed baseline, not the current partial implementation.

The later amendment in [Profile form][t49] replaces its original premise
for an unnamed query: `default` is always the selected profile unless a
selector says otherwise. [Gap answers][t50] adds `gaps` to the profile
shape. [Default benchmarks][t54] settles the taste and above-cap choices
that [Arena evidence][t59] left to it.

Kevin decided the draft's 12 Open Questions on 2026-10-01 in the RFC-02
review. Recommendations for questions 1-7 and 9-12 were accepted as stated:

1. Return normalized profiles with separate implicit/declared provenance;
   use exclusive gap variants, integer ceilings from 1 to 10, and reject
   duplicate membership labels or gap targets.
2. Waive accepted capabilities only for coverage checking, retain joint
   coverage, and report joint failures with candidate rating ceilings.
3. Evaluate stale gaps against task-compatible routes and warn only when
   an applied query hits the accepted limitation.
4. Adopt the six profile codes, including `pin-outside-profile`, and add
   `warnings` to successful check output while retaining failure problems.
5. Use the recommended adaptive interview order and require approval of
   shared route reordering, showing effects on other profiles.
6. Use the recommended snapshot facts and non-secret source scope, safe
   filenames, evidence-backed renames, and pauses on failed reads or
   rejected diffs.
7. Record aggregator currency, unit and price basis; filter locally when
   needed, and use scope-matched harness acceptance plus plan evidence.
8. Fix the banding method, not numbers: compute decile suggestions from
   the user's pinned data and obtain approval. Ship no Artificial Analysis
   band numbers. The same method supplies Arena taste evidence.
9. Keep record-only figures outside active feeds under existing calibration
   keys, without changing loader computation or rewriting ratings.
10. Retain explicit, disambiguated Arena model/effort mappings and source
    evidence without adding a registry format field.
11. Assume no existing format 1 file uses a top-level `profiles` extension.
12. Keep loader/schema example tests in registry and coverage/answer tests
    in router, without a reverse production dependency.

The [band-values amendment][t54] replaces that ticket's earlier assumption
that RFC-02 fixes numeric values. The review decisions are requirements
below. Exact implementation names not fixed by those decisions remain
implementation details, not unresolved product choices.

Source: [The decision map][map], [Profile form and amendment][t49],
[Gap answers][t50], [Default benchmarks and band-values amendment][t54],
[Arena evidence][t59]; Kevin, 2026-10-01, RFC-02 review.

## Terminology

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD
NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be
interpreted as described in RFC 2119.

RFC-01's terms and route identity apply unchanged.

| Term | Meaning |
|---|---|
| **profile** | A named set of route labels in one registry, with a description and optional accepted gap records. A query uses only routes in its selected profile. |
| **declared profile** | A profile explicitly written in the file, including an explicitly written `default`. |
| **implicit default** | The loader-supplied `default` containing every declared route when the file does not declare that profile. |
| **covered** | At a task's stakes level, one route in the profile has the task's needs and clears all its floors together, subject to accepted gaps for the check only. |
| **gap** | A missing capability or rating coverage that the operator accepts with a reason. A gap is not a runtime floor override. |
| **rating ceiling** | A gap's `accepts` value. It records the rating level the profile accepts and covers global task floors above that value. |
| **platform** | A provider, subscription service, aggregator or local runtime from which the operator obtains models. It is not a new registry field. |
| **snapshot** | A saved model list read, with its source, method, date and model ids. A pinned snapshot, not a live read date, permits replay. |
| **catalog** | Cross-provider discovery data. It suggests platforms and models; it does not admit routes. |
| **builder** | The public profile builder prompt followed by an agent. It is documentation, not a package execution engine. |
| **record-only figure** | A measured figure retained with its measured effort but not used to feed a rating because it exceeds the model's effort cap. |

Source: [RFC-01][rfc01], [Profile form][t49], [Gap answers][t50],
[Coverage check][t51], [Discovery][t56] and [Default benchmarks][t54].

## Motivation

An operator can keep a narrow budget profile beside a broader default
without duplicating ratings or tasks. Explicit membership prevents a new
route elsewhere in the registry from silently joining a declared profile.
Coverage checking identifies the work that the profile cannot support
before the operator relies on it. Accepted gaps keep that limitation
visible without changing the global routing floors.

A public builder prompt serves package users who do not have the
operator's private skills. Saved model lists give each build a reproducible
input, while a fresh read and approved diff identify platform changes.

Source: [Roadmap][roadmap], [Profile form][t49], [Gap answers][t50],
[Coverage check][t51], [Builder placement][t55] and [Discovery][t56].

## Design

### Package boundary

| Responsibility | Owner |
|---|---|
| Profile and gap shape, references, implicit `default`, returned profiles | `model-registry` |
| Profile selection, membership restriction, pins and policies, answer warnings | `model-router` |
| Task coverage and stale gap findings | `model-router check` |
| Interview, discovery instructions, snapshots, rating handoff, proposal and approval | Public builder prompt in `model-registry` |
| Operator-specific harnesses, plans and availability context | A thin private skill outside both packages |
| Profile recorded with a router-source decision | graybox |

The loader MUST validate profile data without reading router tasks.
`model-registry check` remains a loader check. Discovery MUST NOT add
package code or provider-specific adapters. Neither package's loader
reads model list snapshots.

Source: [Profile form][t49], [Coverage check][t51],
[Builder placement][t55] and [Discovery][t56].

### Profiles in registry format 1

`profiles` is an OPTIONAL top-level section owned by `model-registry`.
It maps a profile name to a closed object. A declared profile has a
REQUIRED one-line `description`, an explicit list of route labels in
`routes`, and an OPTIONAL `gaps` list.

```json
"profiles": {
  "budget": {
    "description": "Only platform-a routes.",
    "routes": ["model-a@harness-x/provider-a", "model-b@harness-x/provider-a"],
    "gaps": [
      { "rating": "coding", "accepts": 6, "reason": "This set reaches coding 6." },
      { "capability": "browser", "reason": "This set has no browser route." }
    ]
  }
}
```

Membership MUST be explicit labels, not filters by meter, harness or
provider. The loader MUST validate every label against the declared
routes. An unknown label is `reference-unknown`. A profile's `routes`
MUST NOT contain duplicate labels. The loader MUST expose a normalized
profile map and separate provenance identifying each profile as implicit
or declared. The public result field names MUST be documented by the
implementation; no synthesized profile is written to the registry.

Models and routes remain declared once. Every profile shares `ratings`,
`capabilities`, `meters`, model ratings, `calibration`, `router`, `tasks`
and `policy`. Two profiles containing one model therefore use the same
ratings. A model offered through two platforms has two routes.

A route added to the registry joins no declared profile until its label
is added there. The implicit `default` is the exception: it includes all
routes. Shared rating, capability or task edits can change coverage even
when membership does not change.

This is additive to `format: 1`, in a `model-registry` minor release after
1.0.0. RFC-01's loader passes an unknown top-level `profiles` section
through untouched. That older loader does not validate it or enforce
membership. The compatibility assumption is that no existing format 1
file uses an unrelated top-level `profiles` extension. This is an
explicit review assumption, not a loader observation or a format-2
decision. The compatibility audit MUST check that boundary; a conflicting
file MUST NOT be silently reinterpreted under the minor-release claim.

Source: [Profile form and its amendment][t49], extended by
[Gap answers][t50]; [Coverage check][t51]; Kevin, 2026-10-01, RFC-02 review.

### The implicit default

`default` is a reserved profile name. There MUST always be a profile
named `default`.

- When the file does not declare `default`, the loader MUST supply one
  holding every route in the registry.
- When the file declares `default`, its explicit label list MUST win.
- A file with no `profiles` section therefore has exactly one profile,
  the implicit `default`.
- Supplying an implicit profile MUST NOT rewrite the registry. RFC-01's
  loader remains read-only, and its digest remains the hash of file bytes.

The implicit default is not a second pool that another profile can
borrow from. It is selected and restricted like any other profile.

Source: [Profile form, later default amendment][t49],
[Profile selection][t52], [Move to profiles][t60] and [RFC-01][rfc01].

### Accepted gaps

The two settled record shapes are:

```json
{ "rating": "coding", "accepts": 6, "reason": "This set reaches coding 6." }
{ "capability": "browser", "reason": "This set has no browser route." }
```

The loader MUST validate their shape and that every rating and capability
name exists. Profiles and gaps are closed sections. Each gap MUST match
exactly one variant: `{ rating, accepts, reason }` or
`{ capability, reason }`. `accepts` MUST be an integer from 1 to 10.
A profile MUST NOT contain duplicate gaps for the same rating or the
same capability.

A rating gap records a ceiling, not a task-specific floor. `accepts: 6`
accepts every floor above 6 for that rating in every task, including tasks
added later. Floors stay global in `tasks`. Ranking MUST NOT lower those
floors because a gap is recorded.

`model-router` MUST warn when a query hits a recorded gap. The warning
MUST name the profile and the recorded reason. Rating-gap routes remain
`floor: below` when below the query's global floor. When no route has a
needed capability, the capability hard limit still produces an empty
route list. A recorded capability gap does not grant that capability.

The builder MUST offer adding a model or platform that fills the gap, or
accepting the gap with a reason. It MUST NOT borrow from another profile.
It offers no per-profile floor change or separate task-exclusion field.

Runtime gap warnings MUST use the applied query, including inline floors,
inline needs and additional hard limits. The router MUST evaluate the
limitation against routes compatible with the query's other requirements,
not independent maxima from unrelated routes. It MUST warn only when
that query actually hits the recorded limitation. A stale capability
record MUST NOT hide a now-capable route that satisfies the query.
Coverage checking evaluates each relevant task separately as specified
below; a gap record is not a task-specific override.

Source: [Gap answers][t50], with warning ownership and validation from
[Coverage check][t51]; Kevin, 2026-10-01, RFC-02 review.

### Profile selection and records

The query gains an OPTIONAL string field, `profile`. Selection is:

| Caller | Selection order |
|---|---|
| CLI | Query `profile`, then `MODEL_ROUTER_PROFILE`, then `default` |
| Library `rank` | Query `profile`, then `default` |
| graybox router source | Supplies query `profile` from `routing.profile`; absent, uses `default` |

Environment lookup belongs to the CLI, not pure `rank`. There is no
profile key in the router's `config.json` and no per-field CLI flag.
The existing `--registry` and registry path rules do not change.

```sh
model-router '{"task":"implement","profile":"budget"}'
MODEL_ROUTER_PROFILE=budget model-router '{"task":"implement"}'
```

```json
"routing": {
  "source": "router",
  "profile": "budget",
  "defaultNeed": { "task": "general" }
}
```

The graybox fragment adds to RFC-01's configuration; it does not replace
its Primary, admitted routes or other keys. graybox MUST record the
profile next to `registryDigest` with each router-source routing decision.
Its interface display is out of scope. RFC-01's list source and
Owner-named route path remain unchanged; they are not profile queries.

`answer.query.profile` MUST always contain the profile actually used,
including an environment-selected or implicit default value. The answer's
`contract` stays `1`. Labels remain
`<model key>@<harness>[/<provider>]`; no profile suffix is added.

An unknown profile MUST fail, with CLI exit 2 and a `fix` listing the
file's profiles. It MUST NOT fall back to `default`. This is a deliberate
exception to RFC-01's rule that a check against registry content only
warns. Fallback could escape the user's chosen set. The error code is
`profile-unknown`, as specified under [Error Handling](#error-handling).

Source: [Profile selection][t52], [Profile form amendment][t49] and
[RFC-01, Query, Ranking and graybox][rfc01];
Kevin, 2026-10-01, RFC-02 review.

### Membership, pins, policies and route order

The router MUST restrict candidates to the selected profile before
placing pins or policies. No ranked fallback can come from another
profile. A pin outside membership MUST be unused, with a new coded reason
in the pin report. A shared policy route outside membership MUST drop out
with a warning. These rules do not relax privacy, capability, family or
availability limits on routes inside the profile.

After membership restriction, RFC-01's ranking sequence applies:
validate the query, resolve the need, apply hard limits, place the pin,
place the policy, sort the rest, resolve effort, apply availability and
build the answer. Selecting and validating membership adds no comparison
key and does not reorder profile members by their profile label list.

The full RFC-01 sort and availability rules remain in force:

- Clearing routes under `prefer: cost` sort by higher `cost` first,
  then the task's `rank` ratings, then the model's route order.
- `prefer: speed` compares response time first. Below-floor routes
  compare the `rank` ratings before cost. Missing values and final file
  order keep RFC-01's treatment.
- Routes of the same model share ratings. On equal cost, the model's
  written route order breaks the tie. The builder writes that order in
  the order the user listed platforms.
- Availability acts after ranking. `projected` demotes a route unless
  its meter has `spendToZero`; `exhausted` removes a route unless that
  would remove all routes, in which case RFC-01 retains them and warns.

The shared route order can affect other profiles. The builder MUST
preserve an existing shared order unless the user approves a global
reorder. Before approval it MUST show which other profiles that reorder
affects. Neither quota remaining nor platform order becomes a new sort
key. An outside pin MUST use reason `pin-outside-profile`; an outside
policy route MUST warn with `policy-route-outside-profile`.

Source: [Profile form][t49], [Profile selection][t52],
[Route order][t53] and [RFC-01, Sort order and Availability rule][rfc01];
Kevin, 2026-10-01, RFC-02 review.

### Coverage check

`model-router check` MUST check every profile against every declared task
at each of `low`, `normal` and `high` stakes. It does not select only the
CLI environment's profile. A task with no route is not covered merely
because different routes satisfy different parts of the need.

For an unmodified task need, coverage requires at least one route that
has every task capability and clears every task floor at once. For the
coverage check only, a recorded rating gap caps that rating's floor at
`accepts`. The check MUST waive only capabilities with recorded accepted
gaps, then MUST require one route to meet all remaining capabilities and
capped floors together. Accepted capability gaps MUST NOT waive runtime
filtering; runtime queries retain their original needs and floors.

| Finding | Declared profile, including declared `default` | Implicit `default` |
|---|---|---|
| Unrecorded coverage gap | Fails, exit 4 | Same findings as warnings; passes |
| Accepted gap | Checked against the accepted limitation | No gap record exists unless `default` is declared |
| Stale gap record | Warning; passes if no other errors | Not applicable to synthesized records |

For an unrecorded gap the check MUST report one problem per task, stakes
level and missing rating or capability. Its `fix` MUST show the gap record
to add or routes that would fill it. When every rating is reachable but
only through different routes, the problem MUST explain that they do not
clear together. The diagnostic MUST show candidate rating ceilings for
routes compatible with the remaining need, not count separate maxima as
coverage. The operator then records a ceiling on one rating or changes
the route set. Tests MUST include combined rating and capability gaps.

A stale gap MUST warn, identifying the record and a route that fills it.
The check MUST evaluate each record against the tasks that use its rating
or capability. A filling route MUST be compatible with the task's other
needs and floors after the check's accepted-gap adjustments. A compatible
route clearing the original requirement, or reaching above `accepts`,
makes the corresponding accepted limitation stale for that task. The
warning MUST retain the task context when several tasks use one record.

Capability coverage counts only capabilities appearing in some task's
`needs`. Future inline query needs cannot be checked in advance. Coverage
is not a promise about a query's extra capabilities, family exclusions,
secret privacy requirement or live availability.

The command still loads the registry, validates router sections and
configuration, and runs neither an availability command nor Jev. The
loader has no warnings channel. Successful output MUST preserve
`registryPath`, `registryDigest` and `configPath`, and MUST add a
`warnings` array, empty when there are no warnings. Failures MUST retain
coded `problems[]`; the codes and envelope are specified in Error Handling.

Queries MUST NOT fail merely because a profile has a coverage gap.
An empty answer remains exit 3, not a coverage exception. An unknown
selected profile remains the separate exit-2 exception.

Source: [Coverage check][t51], [Gap answers][t50],
[Profile selection][t52] and [RFC-01, model-router CLI][rfc01];
Kevin, 2026-10-01, RFC-02 review.

### The profile builder and rating prompt

`model-registry` MUST ship a public builder prompt beside, not merged
with, its rating prompt. It works with any agent. A private wrapper skill
can supply operator context, but that context MUST NOT enter the package.
The builder MUST hand rating work to the rating prompt, keeping one
rating method. Neither prompt adds a rating engine or uses Jev to rate.

The interview MUST ask one question at a time and skip facts already
provided. It covers the platforms and plans, the profile's purpose and
budget, the ratings and benchmarks that matter, and whether the user
wants a narrow cheap set, the full range or depth at the top. Multiple
platforms supply one pool; the same model through two platforms supplies
two routes. For an aggregator, narrowing precedes reading its candidate
list.

The builder then uses approved model snapshots, hands rating to the
rating prompt, and proposes a set across the requested score range,
ratings and capabilities. It MUST name uncovered work and offer the gap
answers specified above, with a recommendation. The builder MUST use
this adaptive interview order, skipping facts already answered:

1. Platforms and plans.
2. Purpose and budget.
3. Aggregator narrowing, when applicable.
4. Ratings and benchmark approval.
5. Desired score range.
6. Discovery and rating, then gap decisions.

Benchmark approval here confirms the selected sources. Numeric bands
computed from the subsequent pinned read still require approval before
the registry is written.

Before writing a profile, the builder MUST show the proposed membership,
shared fact changes, ratings and bands, and accepted gaps with reasons.
The user MUST approve before the registry is written. Its final step
MUST run both commands, in this order:

```sh
model-registry check
model-router check
```

An explicit registry path can use the existing `--registry` flag on both.
A failed declared-profile coverage check is not a completed build.

Source: [Roadmap, The profile builder skill][roadmap],
[Gap answers][t50], [Builder placement][t55] and
[Default benchmarks][t54]; [RFC-01, The rating method][rfc01];
Kevin, 2026-10-01, RFC-02 review.

### Model list discovery

Discovery MUST live in builder instructions only. Each read MUST run as
a local command, including public sources, so an authenticated source
never requires a credential in hosted model context. Instructions cover
provider endpoints, harness lists, local runtimes, catalogs, and research
as the last resort. Before using a source, the builder checks that source's
current official documentation rather than assuming a common schema.

| Evidence | Use and limit |
|---|---|
| Platform endpoint or harness list | Preferred over catalog data. A harness list is closest to the route's accepted model ids; an API list does not establish subscription inclusion. |
| Local runtime list | Reports installed models, not all models available elsewhere. |
| Pinned public catalog | Suggests unfamiliar platforms and models; lower priority than an endpoint or harness read. |
| Research | Last resort, with cited pages, date read, its non-deterministic method stated, and user approval. It is not proof that a harness reaches a model. |

When API and harness lists conflict, the builder MUST use scope-matched
harness acceptance plus evidence for the user's plan. It MUST NOT use an
API catalog as subscription proof. Research MAY propose candidates, but
MUST NOT replace the endpoint or harness confirmation required before
route admission. A model a harness cannot reach MUST NOT become a route.

The default catalog is models.dev at a recorded revision. Its MIT data
suggests platforms, including subscription providers; it does not supply
plan prices or quotas. A catalog-suggested model MUST be confirmed by an
endpoint or harness read before becoming a route. Plan prices and quotas
come from the user or platform pages.

For an aggregator such as OpenRouter, the builder MUST first ask the
user for a price ceiling, a provider subset, or both. The builder MUST
record the currency, unit and price basis in the interview. It reads the
passing set before rating and picking. When the endpoint cannot apply
the selected filter, the local command MUST filter the response before
rating; the full unfiltered catalog is not the rating pool.

Source: [Model list sources][t47], [Discovery][t56],
[Default catalog and aggregator scope][t57] and [Roadmap][roadmap];
Kevin, 2026-10-01, RFC-02 review.

### Snapshots and staleness

Each read MUST be saved as one JSON snapshot per source in `lists/`
beside `registry.json`. Each snapshot MUST record source, method, date
read and model ids. A models.dev snapshot MUST also record its pinned
revision. The builder uses the snapshot; the same snapshot supplies the
same list. No live source promises the roadmap's earlier same-day rule.

The snapshot shape belongs to the builder prompt, not registry format 1.
Neither loader reads `lists/`. Re-reading or replacing a snapshot MUST
NOT change `registryDigest`; changing the registry's file bytes does.

For every profile build, the builder MUST re-read each source used for
that build and compare it with its snapshot. It MUST show added, removed
or renamed models for approval. The user MUST approve the diff before
the snapshot is replaced. A route whose model left its platform MUST be
flagged for removal from the profile, not silently removed.

The date is shown but MUST NOT alone decide staleness. The builder prompt
MUST define a snapshot containing `source`, `method`, `read`, `modelIds`,
an OPTIONAL `revision`, and a non-secret source-scope identifier. It MUST
document the exact source-scope field name. `revision` MUST be present
for a pinned catalog read. Source scope MUST distinguish lists with
different access scopes without storing credentials or account identifiers.

The builder MUST use an opaque safe filename per source. A filename MUST
NOT contain a credential or account identifier. Rename detection MUST
have source evidence; without it, the diff MUST report added and removed
ids rather than infer a rename. On a failed fresh read or rejected diff,
the builder MUST pause dependent work and MUST NOT silently use stale
data or replace the approved snapshot. Rebuild examples MUST exercise
snapshot replacement and the approval gate.

This RFC adds no package snapshot validator, retention policy or discovery
command. The prompt defines the snapshot contract outside format 1.

Source: [Model list sources][t47], [Discovery][t56] and
[Default catalog][t57]; Kevin, 2026-10-01, RFC-02 review.

### Suggested benchmarks and bands

The builder MUST offer suggestions, not adopt benchmark defaults without
approval. It suggests:

| Rating | Suggested evidence | Condition |
|---|---|---|
| `intelligence` | Artificial Analysis Intelligence Index | User fetches figures with their own key. |
| `coding` | Artificial Analysis Coding Index | User fetches figures with their own key. |
| Route `cost` | Artificial Analysis cost per task | Measured provider and effort match the route; workload comparability matters. Otherwise use an override with a reason. |
| Hand-set `taste` | Arena WebDev `overall` | Evidence and a suggested band, not a computed feed. |

Each benchmark suggestion MUST carry suggested bands. The user MUST
confirm or edit every benchmark and band before the registry is written.
New or changed benchmark versions retain RFC-01's proposal and approval
step. Confirmed bands use RFC-01's ordered `{ at, score }` tables,
direction, first matching band, and floor-of-mean combination rule.

RFC-02 fixes the banding method, not numeric thresholds. The builder
MUST read the user's own pinned data and MUST compute suggested bands
from that distribution using this fixed decile-to-score table:

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

The builder MUST respect `direction`: for `higher`, lower figures are
worse; for `lower`, higher figures are worse. It MUST generate the numeric
thresholds locally from the pinned distribution, record their source
revision or read identity, and present the resulting bands for approval.
The user MUST approve those bands like any other band. The same decile
method MUST apply to Arena WebDev `overall` as hand-set taste evidence;
it MUST NOT turn taste into a computed feed.

The package MUST NOT ship band numbers derived from Artificial Analysis
data. It ships this method, not a fixed numeric table derived from the
user's figures.

The package MUST ship no Artificial Analysis figures. A user fetches
figures with their own key for their own registry. API token prices do
not establish subscription cost, and output speed is not
`responseSeconds`. Coding benchmarks that include an agent, effort and
version require an explicit calibration choice, not a model-name join.
Alternative sources researched in #48 are not additional defaults.

Source: [Benchmark sources][t48], [Default benchmarks and band-values
amendment][t54] and [RFC-01, calibration and The rating method][rfc01];
Kevin, 2026-10-01, RFC-02 review.

### Arena as taste and effort evidence

`taste` MUST remain in `calibration.handSet`, not `feeds`. The builder
shows Arena WebDev `overall` evidence and a suggested 1-10 band while
the user sets taste. Arena measures preference for one-shot web output;
it does not establish taste in review or planning.

The source is the Hugging Face dataset
`lmarena-ai/leaderboard-dataset`, not a scrape of arena.ai. The research
read pinned revision `47c3ea6a`. It found 137 `overall` rows with quartiles
1357, 1440 and 1556. `webdev` duplicated `overall`; pooling both would
count the same evidence twice. Those historical quartiles are not fixed
band thresholds. The builder MUST use the decile method on the user's own
pinned `overall` distribution, then obtain approval of the suggested bands.

Updates are irregular and category-specific. `latest` does not identify
one publication date across categories. Names carry effort, date,
preview and harness variants; untagged effort is unspecified. Mapping
MUST be explicit per source name rather than a suffix-stripping rule.
The retained evidence MUST identify dataset revision, category,
publication date and enough row evidence to distinguish duplicate names.
It MUST include an explicit model/effort mapping. The builder MUST NOT
infer effort for untagged rows. It MUST retain the displayed evidence and
attribution in a local explicit mapping beside the read or in existing
calibration metadata, without adding a registry format field. Taste MUST
remain hand-set.

The pinned read found higher-effort preference differences of about
+30 to +34 points for two pairs, and +25 for another. These are preference
differences, not controlled effects of effort alone. The dataset supplies
no cost evidence. No fixed correction from max to high is justified.
Taste-Bench stays on watch until it publishes scores; it is not an
additional implemented source.

Source: [Arena evidence][t59], applied by [Default benchmarks and
band-values amendment][t54]; Kevin, 2026-10-01, RFC-02 review.

### Figures above the effort cap

A figure measured above a model's `maxEffort` MUST be stored with its
measured effort and MUST NOT feed a rating. When no eligible figure at
or below the cap exists, the rating MUST stay absent unless the user
sets an override with a reason. There is no fixed downward correction.
The routing effort ladder, model limits and global ceiling do not change.

The review accepted the record-only presentation recommendation formerly
recorded in Open Question 9. The builder MUST show record-only evidence
apart from the figures used to produce ratings.

Record-only figures MUST remain under existing calibration keys outside
active `feeds`. Eligible and above-cap measurements of the same benchmark
MUST use distinct benchmark keys, so the eligible key can feed ratings
while the record-only key does not. Existing benchmark metadata and
`notes` record the source; each stored figure MUST retain its `effort`
as RFC-01 requires. No new format field is added.

The loader MUST retain RFC-01's table lookup and rating validation; it
MUST NOT silently rewrite existing computed ratings or add an effort-aware
calculation rule. The builder MUST validate the separation with
`model-registry check`. If an implementation cannot represent record-only
evidence without making a valid file invalid or changing its meaning,
it MUST return the release decision to Kevin under RFC-01's major rule
rather than ship that change in a minor.

Source: [Default benchmarks][t54], informed by [Arena evidence][t59];
[RFC-01, calibration, Rating check and Effort][rfc01];
Kevin, 2026-10-01, RFC-02 review.

### Example registry and adoption

No migration is needed. An operator adds `profiles` to the existing
registry; `default` can remain implicit. The example shipped by
`model-registry` MUST contain one declared profile beside that implicit
default, with at least one accepted gap. All names and figures MUST be
placeholders.

Tests MUST exercise the declared profile's coverage check and a query's
gap warning, in addition to existing schema and loader validation. The
profile fragment above illustrates the decided shape; it is not a new
complete example file. Registry tests MUST own loader and schema
validation. Router tests MUST own coverage and gap-warning answer
assertions against a fixed example artifact. The test setup MUST keep
that artifact consistent with the shipped example and MUST NOT add a
production dependency from registry to router.

Source: [Move to profiles and example registry][t60],
[Coverage check][t51], [Gap answers][t50] and [RFC-01, Packages][rfc01];
Kevin, 2026-10-01, RFC-02 review.

### Roadmap question mapping

Every numbered question in the two roadmap entries has a decision source
and an answer location. Implementation field names do not change the
settled product choices.

| Roadmap question | Answer in this RFC | Decision source |
|---|---|---|
| Profiles 1: separate file or shared named section? | Profiles in registry format 1 | [#49][t49] |
| Profiles 2: who checks completeness, and what fails? | Coverage check; Error Handling | [#51][t51]; Kevin, 2026-10-01, RFC-02 review |
| Profiles 3: selection and default? | The implicit default; Profile selection and records | [#49 amendment][t49], [#52][t52] |
| Profiles 4: one set of ratings across profiles? | Profiles in registry format 1 | [#49][t49] |
| Profiles 5: profile in label or decision record? | Profile selection and records | [#52][t52] |
| Profiles 6: benchmark set, bands or suggestions? | Suggested benchmarks and bands; Arena as taste and effort evidence | [#48][t48], [#54 amendment][t54], [#59][t59]; Kevin, 2026-10-01, RFC-02 review |
| Profiles 7: gap answers, floors and borrowing? | Accepted gaps; Coverage check | [#50][t50], [#51][t51] |
| Profiles 8: combined-platform route order? | Membership, pins, policies and route order | [#53][t53] |
| Profiles 9: stale model list detection? | Snapshots and staleness | [#56][t56] |
| Discovery 1: default public catalog? | Model list discovery | [#47][t47], [#57][t57] |
| Discovery 2: package, tool or instructions? | Package boundary; Model list discovery | [#55][t55], [#56][t56] |
| Discovery 3: date or fresh comparison? | Snapshots and staleness | [#47][t47], [#56][t56] |
| Discovery 4: whole aggregator or narrow first? | Model list discovery | [#57][t57]; Kevin, 2026-10-01, RFC-02 review |

Source: [Roadmap][roadmap] and [The decision map][map];
Kevin, 2026-10-01, RFC-02 review.

## Changes to RFC-01

This section names every extension and the RFC-01 section it touches.
RFC-01's implementation and cutover do not wait for this RFC. Release
categories below apply after 1.0.0; they do not assign graybox a package
version. No decided change requires format 2 or contract 2.

| Change | RFC-01 section touched | Release |
|---|---|---|
| Add owned, closed `profiles`, gap validation and implicit `default`; return profiles | Protocol Overview: The two packages; Message Formats: Top-level sections, References between sections, The loader's result | `model-registry` minor, `format: 1` |
| Add optional query `profile`, CLI `MODEL_ROUTER_PROFILE`, applied `answer.query.profile` | Message Formats: Query and Answer; Packages: model-router CLI | `model-router` minor, `contract: 1` |
| Restrict membership; refuse unknown profiles; keep pins and policy routes inside it | State Machine: Ranking; Error Handling: model-router | `model-router` minor; new errors and reasons, existing exit 2 |
| Check every profile; distinguish declared-profile failures from implicit-default warnings; warn on stale records; add check `warnings` | Packages: model-router `check`; Error Handling: model-router | `model-router` minor; additive output and new codes, existing exits |
| Warn on accepted gaps without lowering runtime floors | Message Formats: Answer; State Machine: Ranking; Error Handling | `model-router` minor; new warning codes |
| Add graybox `routing.profile` and record profile beside digest | Message Formats: graybox's routing section; Consumers: graybox, Source identity | Additive consumer configuration and record change accompanying the router minor; graybox release numbering is not specified |
| Ship the separate builder prompt and have it run both checks | Packages: model-registry; Consumers: Skills | `model-registry` minor for the new profile-producing prompt; later wording changes patch and produced-output changes minor |
| Compute user-confirmed decile band suggestions from pinned user data; show Arena evidence for hand-set taste; ship no Artificial Analysis band numbers | Packages: The rating method; Implementation Notes: Assumptions | `model-registry` patch for prompt wording under #54 and its amendment; no automatic default ratings |
| Record above-cap figures under existing calibration keys outside active feeds | Packages: The rating method; Message Formats: calibration and Rating check | Prompt guidance patch under #54; loader computation unchanged. A changed valid-file meaning would require a separate major decision |
| Add discovery and snapshot instructions, pinned catalog and aggregator narrowing | Packages: model-registry documentation; Security Considerations: Credentials | Included with the builder minor; subsequent wording-only changes patch. No loader or discovery API change |
| Add a declared profile and accepted gap to the example | Packages: model-registry published example and tests | `model-registry` patch for example data |
| Require no profile migration | Cutover; Packages: model-registry migrate | No migration code or release of its own; explanatory documentation patch |

RFC-01's Sort order, Availability rule, route label format, digest,
consumer walk and effort resolution remain unchanged. Explanatory text
about them is patch-only documentation, not a ranking change.

Source: [Profile form][t49], [Gap answers][t50], [Coverage check][t51],
[Profile selection][t52], [Route order][t53], [Default benchmarks][t54],
[Builder placement][t55], [Discovery][t56], [Default catalog][t57],
[Move to profiles][t60] and [RFC-01, Versioning][rfc01];
Kevin, 2026-10-01, RFC-02 review.

## Versioning

### model-registry

RFC-01 ships first, through 1.0.0. Profiles, gaps and the loader result
addition ship in a following minor, with registry `format` still `1`.
The example and rating-prompt wording follow RFC-01's patch rule. Decile
suggestions are prompt guidance using the user's pinned data, not shipped
Artificial Analysis band numbers or a package rating engine. Record-only
storage uses existing keys and leaves loader computation unchanged.
The builder follows the rating prompt's rules: wording changes are patch,
and a change to what it produces is minor. No version number beyond
"a minor after 1.0.0" is selected here.

An older loader passes `profiles` through but does not understand it.
A profile-aware router therefore needs a profile-aware registry loader.
The minimum dependency release is selected when that release exists;
the dependency remains a caret range in the major. No automatic
migration or downgrade behavior is added.

Source: [Profile form][t49], [Builder placement][t55],
[Default benchmarks][t54], [Move to profiles][t60] and
[RFC-01, model-registry and Dependencies and pins][rfc01];
Kevin, 2026-10-01, RFC-02 review.

### model-router

The optional selector, new applied query content, environment variable
and codes are minor additions; answer `contract` stays `1`. Coverage and
gap warnings join that profile-aware release under the tickets' additive
assumption. A code is still open vocabulary: consumers MUST accept codes
they do not know. Existing CLI exits remain 0, 1, 2, 3, 4 and 5 with the
profile-specific uses described here.

RFC-01's rules still govern a future change: a query or answer break
requires a major and contract increment; a CLI, API or config break
requires a major; ranking changes are minor; text-only changes are patch.
Record-only storage MUST preserve existing calibration semantics. It is
not permission to ship a breaking loader change in a minor.

Skills still resolve the CLI at `@latest`; graybox still pins an exact
router version and its lockfile. Distribution remains the two public
`@dungle-scrubs` npm packages. No alternative distribution is added.

Source: [Profile selection][t52], [Coverage check][t51] and
[RFC-01, model-router, Dependencies and pins, Distribution][rfc01];
Kevin, 2026-10-01, RFC-02 review.

## State Machine

### Routing a profile query

```
LOAD_REGISTRY -> RESOLVE_PROFILE -> CHECK_PROFILE
CHECK_PROFILE -> FAIL (unknown profile, exit 2)
CHECK_PROFILE -> RESTRICT_MEMBERSHIP -> RFC01_RANKING -> ANSWER
ANSWER        -> routes present (exit 0)
ANSWER        -> no routes (exit 3)
```

Registry and configuration failures retain RFC-01's exit 4. Gap records
add warnings, not failure transitions. `rank` remains synchronous and
pure. Availability and the consumer walk do not acquire a profile escape.

Source: [Profile selection][t52], [Gap answers][t50],
[Profile form][t49] and [RFC-01, Ranking][rfc01].

### Building a profile

```
INTERVIEW -> NARROW_AGGREGATORS -> READ_SOURCES -> COMPARE_SNAPSHOTS
COMPARE_SNAPSHOTS -> USER_APPROVES_DIFF -> USE_APPROVED_SNAPSHOTS
USE_APPROVED_SNAPSHOTS -> RATING_PROMPT -> PROPOSE_MEMBERSHIP_AND_GAPS
PROPOSE_MEMBERSHIP_AND_GAPS -> USER_APPROVES_REGISTRY -> WRITE_REGISTRY
WRITE_REGISTRY -> REGISTRY_CHECK -> ROUTER_CHECK -> FINISHED
REGISTRY_CHECK or ROUTER_CHECK -> FINDINGS -> REVISE_PROPOSAL
```

The interview MUST follow the adaptive order specified in Design.
A failed read or rejected snapshot diff MUST pause dependent work; neither
allows silent fallback to stale data. A revision that changes the proposed
registry MUST receive approval before another write.

Source: [Roadmap][roadmap], [Builder placement][t55], [Discovery][t56],
[Default catalog and aggregator scope][t57] and [Default benchmarks][t54];
Kevin, 2026-10-01, RFC-02 review.

## Error Handling

### Settled outcomes

All errors, warnings, reasons and problems retain RFC-01's coded shape:
`code`, `message`, optional `field` and `fix`. Loader errors retain `path`
and `problems[]`; router errors retain their existing envelope.

| Finding | Owner and outcome | Recovery |
|---|---|---|
| Bad profile/gap shape or unknown field | Loader error, exit 4; existing `registry-invalid` | Correct the named field. |
| Unknown route, rating or capability reference in profiles | Loader error, exit 4; existing `reference-unknown` | Declare the reference or remove it. |
| Unknown selected profile | Router error, exit 2 | `fix` lists available profiles; caller selects one, no fallback. |
| Pin outside selected profile | Unused pin with coded reason; rank fallback inside profile | Change the pin or explicitly select another profile. |
| Policy route outside profile | Warning; omit that policy route | Edit membership or policy deliberately. |
| Unrecorded declared-profile coverage gap | `model-router check`, exit 4 with problems | Add a filling route or approve a gap record with a reason. |
| Unrecorded implicit-default gap | Check warning, exit 0 if otherwise valid | Same repair choices, without breaking old files. |
| Stale accepted gap | Check warning | Review the identified record and filling route. |
| Query hits accepted gap | Answer warning; normal exit 0 or 3 | Read the profile and reason; do not relax hard limits silently. |

Source: [Profile form][t49], [Gap answers][t50], [Coverage check][t51],
[Profile selection][t52] and [RFC-01, Coded objects and Error Handling][rfc01].

### New codes and check output

Implementations MUST use these profile codes with the meanings below.

| Code | Use |
|---|---|
| `profile-unknown` | Unknown selector error |
| `pin-outside-profile` | Unused pin reason |
| `policy-route-outside-profile` | Policy membership warning |
| `profile-gap-unrecorded` | Per-finding coverage problem, or implicit-default warning |
| `profile-gap-stale` | Stale-record check warning |
| `profile-gap-accepted` | Runtime accepted-gap warning |

Each problem MUST carry a field pointing into the relevant profile, task
or gap. Its message MUST identify profile, task and stakes where applicable.
A coverage failure MUST use `profile-gap-unrecorded` and retain coded
`problems[]` in the existing router error envelope. Earlier loader,
router-section or configuration failures MUST retain RFC-01's codes and
reporting; coverage MUST NOT replace those errors. No code changes the
settled exits.

Successful `model-router check` output MUST have this additive shape:

```json
{
  "registryPath": "<resolved registry path>",
  "registryDigest": "sha256:<hex>",
  "configPath": null,
  "warnings": []
}
```

`configPath` retains RFC-01's path or `null` rule. `warnings` MUST contain
coded implicit-default coverage and stale-gap findings when present.
`model-registry check` and the loader's no-warning contract stay unchanged.

Source: [Coverage check, assumptions][t51], [Profile selection,
assumptions][t52] and [RFC-01, Coded objects][rfc01];
Kevin, 2026-10-01, RFC-02 review.

## Security Considerations

### Credentials and local reads

Model list and benchmark reads MUST keep credentials local. An agent
prompt receives pointers and non-secret evidence, not authentication
values. An authenticated read runs as a local command; no package
credential store or credential path is added. The user's Artificial
Analysis key is never package data.

A provider endpoint's response is not proof of subscription entitlement.
An accepted harness id is not, by itself, a proven plan allowance. The
builder's proposal and approval steps keep those evidence limits visible.
No adapter silently expands a chosen profile or substitutes another one.

Source: [The decision map, Credentials][map], [Model list sources][t47],
[Benchmark sources][t48], [Discovery][t56] and [Default catalog][t57].

### Public data and licensing

The packages and trackers MUST contain no operator-specific registry,
plans, credential paths, machine names or private tool names. Public
examples use placeholders. The private wrapper skill and local snapshots
stay outside the published package data.

Artificial Analysis figures MUST NOT ship. Its researched terms allow
internal use but restrict raw redistribution and third-party
ranking/model-selection uses without written rights. A user-owned key is
not a general redistribution license. The package MUST NOT ship band
numbers derived from Artificial Analysis data. The builder MUST compute
and seek approval for decile suggestions from the user's own pinned data
locally; the published prompt fixes the method only.

Arena dataset figures can be stored in a user's registry under CC BY 4.0.
Public sharing MUST include attribution, a dataset source link, the
license and an indication of changes when figures are transformed.
The dataset's license is distinct from its row's model-license field.
Use the Hugging Face export, not the website scrape. models.dev's MIT
catalog license does not establish licenses for other endpoint responses.

Source: [Benchmark sources][t48], [Default benchmarks and band-values
amendment][t54], [Model list sources][t47], [Arena evidence][t59] and
[RFC-01][rfc01]; Kevin, 2026-10-01, RFC-02 review.

### Trust boundaries and blast radius

The operator's registry remains trusted configuration whose shape the
loader validates. External lists and benchmark rows are evidence, not
instructions to the builder. The user approves list changes, bands,
ratings, shared edits and gaps before the registry changes.

A malformed owned profile can stop all calls loading that registry,
with exit 4. An unknown profile stops its ranking call rather than
ranking a broader default. A missing capability still removes routes;
a recorded gap is not permission to ignore privacy or admit a route.
Snapshots lie outside the digest: the decision identifies the registry
bytes used, not a hash of every external discovery artifact. Pure ranking
makes no discovery or benchmark network call.

Source: [Profile form][t49], [Gap answers][t50], [Profile selection][t52],
[Builder placement][t55], [Discovery][t56] and [RFC-01][rfc01].

## Alternatives Considered

| Alternative | Why it was not adopted | Decision source |
|---|---|---|
| Separate full registry file for each profile | Duplicates declarations and ratings; the chosen form shares one registry. | [#49][t49] |
| Membership filters by meter, harness or provider | New routes could silently change a declared set; explicit labels control membership. | [#49][t49] |
| Per-profile floors or borrowed routes | Floors stay global; borrowing from another profile is disallowed. | [#50][t50] |
| Unknown-profile fallback to `default` | Could route outside the chosen set. | [#52][t52] |
| Profile suffix in route labels | Labels remain stable; applied query and decision records carry profile. | [#52][t52] |
| New quota or platform sort key | RFC-01 already defines cost, route order and availability. | [#53][t53] |
| Merged builder and rating prompt | Two prompts retain one reusable rating method. | [#55][t55] |
| Discovery code or provider adapters in the package | Discovery belongs to prompt instructions and local commands. | [#56][t56] |
| Same-day determinism or date-only refresh | Live sources change; snapshots replay, and fresh diffs detect changes. | [#47][t47], [#56][t56] |
| Rate an entire aggregator catalog first | User narrowing keeps rating work and rebuild diffs small. | [#57][t57] |
| Automatically computed Arena taste or fixed effort correction | Preference evidence does not establish review/planning taste or an isolated effort effect. | [#54][t54], [#59][t59] |
| Ship Artificial Analysis figures or add a profile migration | Figures have redistribution limits; implicit default already supports old files. | [#48][t48], [#54][t54], [#60][t60] |

Source: The tickets in the table; [The decision map][map].

## Implementation Plan

This is the handoff order implied by the package boundary, not a new
cutover schedule. RFC-01 proceeds to 1.0.0 independently. The map's next
step is review and acceptance of RFC-02 before implementation tickets
are cut.

1. Review the specification with the 2026-10-01 decisions incorporated,
   then accept it before cutting implementation tickets.
2. Implement the additive loader/schema/type changes, implicit default,
   and placeholder example in `model-registry`. Verify files with no
   profiles remain loadable and declared references are checked.
3. Implement the selector, membership limits, coded findings and
   all-profile coverage check in `model-router`, using the new loader.
   Verify unknown selectors, outside pins/policies, accepted and
   unrecorded gaps, joint coverage and stale records.
4. Publish the builder prompt and rating-prompt wording with approved
   snapshot and band guidance. Verify proposal/approval gates and both
   final checks using placeholder data; do not add discovery code.
5. Update consumers to supply and record the selector. Verify CLI
   precedence and a graybox router-source decision's profile and digest.
   Keep its display work outside these tickets.

Release the registry changes before the router dependency update, under
the package rules above. No registry migration, commit to private
configuration, consumer deployment or implementation is authorized by
this draft itself.

Source: [The decision map, Destination and Baseline][map],
[Profile form][t49], [Coverage check][t51], [Profile selection][t52],
[Builder placement][t55], [Move to profiles][t60] and
[RFC-01, Dependencies and pins][rfc01];
Kevin, 2026-10-01, RFC-02 review.

## Open Questions

None remains open after Kevin's 2026-10-01 RFC-02 review.

## References

### Normative

- [RFC-01: Shared model registry and router][rfc01] - baseline format,
  ranking, coded objects, consumers and release rules.
- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) - requirement keywords.
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) - existing
  schema dialect.
- Kevin, 2026-10-01, RFC-02 review - the decisions recorded in
  [Where the decisions come from](#where-the-decisions-come-from).
- The resolutions, including later amendments, that this RFC renders:
  - [Establish the model list sources][t47]
  - [Establish the benchmark sources][t48]
  - [Decide the profile's form and what profiles share][t49]
  - [Decide the gap answers and per-profile floors][t50]
  - [Define the coverage check][t51]
  - [Define profile selection and how the answer records it][t52]
  - [Decide route order when platforms offer the same model][t53]
  - [Decide the builder's default benchmarks][t54]
  - [Decide where the profile builder lives][t55]
  - [Decide where model list discovery lives and how stale lists are detected][t56]
  - [Choose the default catalog and aggregator scope][t57]
  - [Arena leaderboard data as a taste proxy and effort evidence; Taste-Bench watch][t59]
  - [Decide the move to profiles and the example registry][t60]

### Informative

- [Map: registry profiles and model list discovery][map] - scope,
  baseline and decision sequence.
- [Roadmap][roadmap] - the two originating entries and their questions;
  the resolutions supersede unsettled roadmap proposals.
- [models.dev](https://github.com/anomalyco/models.dev) - suggested
  catalog, read at a pinned revision.
- [Arena leaderboard dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/tree/47c3ea6a) - pinned dataset used in #59.
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) - Arena data
  attribution and sharing conditions.
- [Taste-Bench](https://www.taste-bench.com/benchmarks) - watch item, not
  an adopted source.

Source: [The decision map][map], [Model list sources][t47],
[Benchmark sources][t48] and [Arena evidence][t59];
Kevin, 2026-10-01, RFC-02 review.

[rfc01]: ./01_shared-model-registry-and-router.rfc.md
[roadmap]: ../roadmap.md
[map]: https://github.com/dungle-scrubs/model-registry/issues/46
[t47]: https://github.com/dungle-scrubs/model-registry/issues/47
[t48]: https://github.com/dungle-scrubs/model-registry/issues/48
[t49]: https://github.com/dungle-scrubs/model-registry/issues/49
[t50]: https://github.com/dungle-scrubs/model-registry/issues/50
[t51]: https://github.com/dungle-scrubs/model-registry/issues/51
[t52]: https://github.com/dungle-scrubs/model-registry/issues/52
[t53]: https://github.com/dungle-scrubs/model-registry/issues/53
[t54]: https://github.com/dungle-scrubs/model-registry/issues/54
[t55]: https://github.com/dungle-scrubs/model-registry/issues/55
[t56]: https://github.com/dungle-scrubs/model-registry/issues/56
[t57]: https://github.com/dungle-scrubs/model-registry/issues/57
[t59]: https://github.com/dungle-scrubs/model-registry/issues/59
[t60]: https://github.com/dungle-scrubs/model-registry/issues/60
