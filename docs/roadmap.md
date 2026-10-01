# Roadmap

Work planned after RFC-01. An entry here is not a decision. It goes
through its own fit check and design before any code is written.

## Profiles: complete, separate sets of models

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

**The profile builder skill.** Profiles come with a skill that builds
one from a plain request, such as "I subscribe to platform X" or "a
monthly plan on platform Y":

1. The skill reads which models that platform offers.
2. By default it picks models that cover the full range of scores across
   every rating and capability. The request can ask for fewer models (a
   narrow, cheap set) or more (depth at the top).
3. It rates the models against a default set of public benchmarks, with
   Artificial Analysis as the default source. The user can name the
   benchmarks or ratings they care about instead.
4. It reports what the platform cannot cover: a capability no model on
   it has, or a floor no model on it reaches.
5. The output is a profile the user saves, then switches to when needed.

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
7. A profile that cannot be complete on its platform: does the skill
   refuse it, save it with the gaps listed, or fill the gaps from
   another profile with the user's approval? The completeness rule
   above forbids silent borrowing.
8. Where does the platform's model list come from (the provider's API,
   the harness, or the user), and how is a stale list detected?
