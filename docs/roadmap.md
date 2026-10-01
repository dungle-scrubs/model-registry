# Roadmap

Work planned after RFC-01. An entry here is not a decision. It goes
through its own fit check and design before any code is written.

## Profiles: complete, separate sets of models

**Start.** This work, with "Model list discovery" below, starts with a
wayfinder map once Kevin is ready. Nothing is built or ticketed
before that map settles the questions in both entries.

**Want.** An operator keeps several sets of models side by side and
chooses one per consumer or per run. Example: a budget profile built only
from models on one low-cost subscription, next to the default profile.

**Requirement.** Every profile is complete on its own. It covers every
capability and every intelligence and taste floor that the router's
tasks ask for. A query on a profile never borrows a route from another
profile.

**What exists today.** The loader takes an explicit path
(`--registry`, `MODEL_REGISTRY_FILE`), so a second complete
`registry.json` already works as a separate set. That has two gaps:

- Nothing checks that a file is complete. A budget file can miss a
  capability or fall short of a floor, and the gap shows up only as a
  query with no passing route.
- Two files duplicate the shared declarations (`ratings`,
  `capabilities`, `meters`, `calibration`) and the `router` section, and
  they drift apart.

**The profile builder skill.** Profiles come with a skill that
interviews the user about what the profile should be made of, then
builds it. The user can open with a plain request, such as "I subscribe
to platform X", "a monthly plan on platform Y", or "I have platforms X
and Y".

1. **Interview.** The skill asks one question at a time, and skips what
   the opening request already answered: which platforms and plans, what
   the profile is for, the budget, which ratings and benchmarks matter
   (Artificial Analysis by default), and whether the user wants a narrow
   cheap set, the full range, or depth at the top.
2. **Read the models.** It reads which models each named platform offers
   (see "Model list discovery"). With several platforms, the profile
   draws from all of them as one pool, and a model offered on two
   platforms becomes two routes.
3. **Rate and pick.** It rates the models against the chosen benchmarks
   and picks the set that covers the range of scores the user asked for,
   across every rating and capability.
4. **Resolve gaps with the user.** When a capability or a score band has
   no model, the skill does not stop and does not fill the gap silently.
   It names the gap, says which work it affects, and helps the user pick
   the answer that fits this profile, with a recommendation. Examples:
   add a model or platform that fills it; accept a lower floor for that
   rating in this profile; or mark the work that needs it as out of
   scope for this profile.
5. **Save.** The output is a profile the user saves, then switches to
   when needed. The profile records each gap decision and its reason.

The skill extends the rating method prompt (RFC-01, "The rating
method"). Like that prompt, it proposes and the user approves before
anything is written, and it ends with `model-registry check`.

**Questions to settle.**

1. Is a profile a separate file, or a named section inside one registry
   that shares the declarations?
2. Completeness: does `check` take a profile and fail when a task's
   needs have no route in it (a coverage check), with a problem per
   uncovered capability or floor?
3. Selection: how does a consumer name a profile (flag, environment
   variable, graybox `routing.registry`, query field), and what is the
   default?
4. Does a model that appears in two profiles keep one set of ratings?
5. Does a profile change the label, or does the answer record the
   profile next to the registry digest?
6. A default benchmark set changes RFC-01. The RFC ships no default
   bands, and its rating prompt asks the user which benchmarks feed
   each rating. Does the skill ship a default set of benchmarks, a
   default set with bands, or only a suggestion that the user confirms?
7. Which gap answers does the skill offer? Accepting a lower floor
   makes "complete" relative to the floors the user agreed for that
   profile. Does the format store a per-profile floor, and does the
   router report when a query falls below the global floor because of
   it? Filling a gap from another profile breaks the completeness rule
   above, so is that an answer at all?
8. In a combined profile, when two platforms offer the same model,
   which route goes first: the cheaper one, the one with more quota
   left, or the order the user listed the platforms in?
9. How is a stale model list detected? See "Model list discovery".

## Model list discovery

**Want.** The profile builder finds each platform's model list by a
deterministic method wherever one exists: the same request on the same
day gives the same list. This covers platforms the operator already
knows, platforms the operator has not heard of that sell a subscription,
and aggregators such as OpenRouter.

**Candidate sources, most deterministic first.** Each needs checking
against the source's current documentation before use.

1. **The platform's own model list endpoint.** Many providers answer an
   OpenAI-compatible `GET /v1/models`. OpenRouter publishes a model list
   with prices and context length. A local runtime such as Ollama lists
   the models it has installed.
2. **The harness.** A harness that already reaches the platform can list
   the model ids it accepts. That list is the one that matters for a
   route, because a route is a model reached through one harness.
3. **A public catalog of providers and models.** A catalog maintained
   across many providers can name subscription platforms the operator
   does not know about, and the models each one offers.
4. **Research, as a last resort.** For a platform with none of the
   above, an agent reads the platform's pricing and model pages. This is
   not deterministic. The result says so, cites its pages with the date
   read, and the user approves the list before it is used.

**Rules.**

- Every list records its source, the date read and the method (endpoint,
  harness, catalog, or research), so a profile shows how far to trust it.
- A list from the endpoint or the harness wins over a catalog. A catalog
  wins over research.
- A model on the list that a harness cannot reach does not become a
  route.
- Reading a list never needs a credential to appear in a hosted model's
  context. Reading a list that needs an authenticated endpoint runs as
  a local command.

**Questions to settle.**

1. Which public catalog, if any, is trustworthy enough to be the default
   for platforms the operator does not know?
2. Is discovery part of `model-registry`, a separate tool, or only the
   skill's instructions?
3. How is a stale list detected and refreshed: by date, or by comparing
   it with a fresh read before each profile build?
4. For an aggregator such as OpenRouter, which offers hundreds of
   models, does the skill pick from the whole list, or does the user
   name a price ceiling or a provider subset first?
