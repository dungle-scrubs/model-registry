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
