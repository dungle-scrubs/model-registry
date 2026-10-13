# Coverage and accepted gaps

Load this file when a task is uncovered, when the user asks to record an
accepted gap, or when a check reports a coverage finding.

## How coverage is checked

`model-router check` tests every profile against every task in `tasks`, at
`low`, `normal` and `high` stakes. A task and stakes level is covered when
one member route clears every requirement together: each floor in the
task's `minimums` at that stakes level, read from the route's model
`ratings`, and each capability in the task's `needs`, read from the route's
`capabilities`. Requirements must clear together on one route. The best
value of each requirement on different routes does not cover the task.

A declared profile with an uncovered task fails the check with
`profile-gap-unrecorded`. The implicit `default`, which holds every route,
reports the same findings as warnings, and the check passes.

## Gap records

A profile's `gaps` list records the limitations the user accepts. Each record
has exactly one of two shapes:

- `{ "rating": "coding", "accepts": 6, "reason": "Reaches coding 6." }`
- `{ "capability": "browser", "reason": "No browser route." }`

The rules for both:

- A rating record caps that rating's floor at `accepts`, an integer from 1
  to 10, in every task and stakes level, for coverage only.
- A capability record waives that capability in every task's `needs`, for
  coverage only.
- The rating or capability must be declared in `ratings` or
  `capabilities`. `reason` is a non-empty line, in the user's words.
- One profile holds at most one record per rating and one per capability.

A record never changes routing: at run time a missing capability still
removes the route, and a route below a floor stays below it. A query that
hits the limitation gets a `profile-gap-accepted` warning with the reason.

## Offering gap answers

For each uncovered task and stakes level, name the requirement that fails
and offer only the answers that can close it, with your recommendation:

- Add a filling route or platform to the profile. A profile borrows no
  route from another profile, and records no per-profile floor; floors stay
  global in `tasks`.
- Accept a capability gap with a reason. A capability record can always
  express a missing capability; the task's other requirements must still
  clear together on one member.
- Accept a rating gap with a reason, only when a compatible member exists:
  a member whose model has that rating and that clears every other
  requirement of the same task and stakes level. Offer `accepts` at most the
  highest value such a member has, which is the value the
  `model-router check` fix names. Because one record caps the rating
  everywhere, choose a value every uncovered task and stakes level can reach.

When no compatible member exists - no member is rated for that rating, or
none clears the other requirements together - no rating record can make
coverage pass. Do not offer one. Offer instead: obtain the rating through
`references/rating.md`; an override or a hand-set value the user approves,
under the rating prompt's Step 4; or a filling route.

## Recording a gap

When the request is only to record an accepted gap:

1. Read the target's profile, its routes, `tasks`, its existing `gaps` and
   the member ratings. Run `model-router check` against the target to see
   the current findings.
2. Ask only for what the request and the file do not give: which profile,
   which rating or capability, and the user's reason.
3. Check the record against "Offering gap answers". When no valid record
   can express it, say so and offer the other answers.
4. Show the record as a proposal; on approval, write it and run the
   finishing checks in `SKILL.md`.

## Check findings

Show the user every warning either check reports, and get the user's
decision on each; the work finishes when every warning has the user's
decision. For a `profile-gap-unrecorded` warning on the implicit `default`,
offer the repair choices: add a filling route, declare `default` with a gap
record when "Offering gap answers" allows one, or leave `default` implicit
(the check passes), with your recommendation. For a `profile-gap-stale`
warning on the profile this work builds or changes, offer to update or
remove the record. For a `profile-gap-stale` warning on another declared
profile, name that profile and offer to update or remove its record; that
profile changes only with the user's explicit approval. A choice that
changes the registry is a revised proposal, approved before another write.

A failed declared-profile coverage check leaves the work unfinished. When
the failing profile is the one this work builds or changes, return to the
proposal and close the gap or record its acceptance. When it is another
declared profile, name it and offer its gap answers under "Offering gap
answers", or offer to withdraw the shared change, such as a lowered rating,
with your recommendation. The choice is a revised proposal approved before
another write, and another profile is never changed without the user's
explicit approval. Then run the checks again.
