# Mode-Aware Normal-Free Discovery Study

## Scope

This document supplements the existing Discovery model. It does not replace the
direct-results, lineage, population-benchmark, Maiden, Tournament or Pro League
workflows. The shared Discovery methodology applies independently to Horse, Car
and Bike. Pro League remains Bike-only under its separate authority.

## Current-versus-required audit

| Area                  | Existing repository state                                                                                      | Clarified requirement                                                                    | Result                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Mode partitioning     | Probe, lineage, benchmark and performance keys already include Core, mode and exact distance                   | Owner + Core + mode + distance + evidence class                                          | Preserved and extended with evidence-class partitions                            |
| Analytical boundary   | Ten exact-distance races is the minimum minimally analytical sample                                            | Twenty usable normal-Free observations is the owner test target                          | Both retained as distinct concepts; neither silently replaces the other          |
| Source classification | Historical archive has outcome/time fields but no authoritative race name                                      | Standalone `Free` token in race name, never zero price                                   | Added token-aware classifier; legacy evidence remains `unknown`                  |
| Evidence categories   | Tournament, star, direct time and lineage inputs were separately represented, but normal-Free was not explicit | Normal-Free, competitive, tournament, esports and lineage must remain visible            | Added explicit evidence classes and audit partitions                             |
| Measurements          | Existing exact-distance profiles already calculate time/speed central tendency and dispersion                  | Normal-Free-only mean, median, best, worst, standard deviation, CV, range and completion | Added normal-Free metric contract without changing profile values                |
| Preferred distances   | Existing probes are exact-distance and lineage-aware                                                           | Any number of `TEST` distances; no forced bands                                          | Added transparent preferred-gate output with no forced coverage                  |
| Fallback              | No distinct broad fallback state                                                                               | Exactly one short, middle and long `SCREEN` only when no preferred distance passes       | Added mode-configured least-weak/neutral fallback selection                      |
| Test completion       | Existing planner reports remaining races to ten                                                                | Existing usable observations reduce 20; completed tests do not reopen automatically      | Added configurable target, capped completion and zero remaining after completion |
| Pagination            | API acquisition already fails closed on partial history                                                        | Partial history cannot publish recommendations                                           | Reused the safeguard at the recommendation publication boundary                  |
| UI                    | Existing owner page shows exact-distance cards                                                                 | Mode selector, matrix, per-distance tables and audit filters                             | Added the interface contract and explicit unavailable-authority state            |
| Persistence           | Existing compact schema is mode-aware but legacy race facts lack race names/evidence class                     | Persist provenance without fabricated reclassification                                   | No migration yet; see authority boundary below                                   |

## Evidence classification

A normal-Free race is identified only when the authoritative race name contains
the standalone word `Free`, case-insensitive, equivalent to `\bFree\b`.
`Free`, `Free Bike` and `free bike` qualify. `Freedom Cup` does not. Entry price,
subsidy and tournament admission are not classification authority.

The evidence classes are:

- `normal_free`;
- `competitive`;
- `tournament`;
- `esports`; and
- `unknown`.

An explicit event/tournament/esports classification may be retained when the
name does not qualify as normal-Free. Missing or contradictory authority remains
unknown. Normal-Free observations never update displayed profile power,
displayed profile variance or adjusted odds. Their position, win and podium
fields remain retained secondary context; speed and repeatability drive the
normal-Free measurements.

Every retained observation contract contains owner, Core HID, Core name, race
ID, race name when authoritative, racing mode, exact distance, recorded time,
position, gate/field size, evidence class, event/tournament identity when
available, observation time, retrieval time and source authority. Identical
authoritative race observations deduplicate; contradictory duplicates fail
closed.

## Distance configuration

Distance lists and short/middle/long bands are versioned per racing mode. They
must not overlap and cannot contain a distance absent from the same mode's
supported list.

The owner-reviewed current Bike configuration is:

| Band   | Exact distances        |
| ------ | ---------------------- |
| Short  | 1000 m, 1200 m, 1400 m |
| Middle | 1600 m, 1800 m         |
| Long   | 2000 m, 2200 m         |

Horse and Car configurations use the same domain contract but remain
authority-pending. The application must not copy Bike distances into those
modes merely to populate a control. Connected API evidence or an explicit owner
configuration is required first.

## Recommendation rules

`TEST` means an exact distance passed a transparent preferred-evidence gate.
The gate may use encouraging limited own competitive results, own normal-Free
speed, same-mode/same-distance parent evidence, a transparent combination or
another mode-appropriate signal. Sample sizes and provenance remain visible.
Lineage is a prior, never proof. Zero parent observations are unknown. Clearly
negative own evidence blocks a parent-only preferred recommendation.

A Core may have zero, one, several or all supported distances marked `TEST`. No
off-distance is added to balance bands.

If no distance passes the preferred gate, exactly one distance from each
configured band is marked `SCREEN`. The selector avoids clearly negative own
evidence when another band option exists, then uses the strongest supplied
screening signal. If all options are unknown, it uses a neutral representative
and states that no supporting evidence exists. `SCREEN` is never displayed as
preferred.

## Normal-Free test target and measurements

The default owner target is 20 usable normal-Free observations for one owner,
Core, mode and selected exact distance:

`additional = max(0, target - usable normal-Free observations)`

The target is supplied as configuration, not encoded in schema. At target, the
test becomes complete, planned additions stop at zero and later naturally
acquired observations remain retained. Reopening requires a separate explicit
owner decision or documented trigger.

Speed is metres per second: `exact distance metres / elapsed seconds`. The
normal-Free summary exposes usable count, median, mean, best, worst, population
standard deviation, coefficient of variation, range, completion percentage and
remaining observations. These are descriptive and same-distance comparisons
are preferred. No permanent promotion threshold or cross-mode normalization is
invented.

## Owner configuration boundary

Squad/extra/protected membership, preferred and fallback selections, test
target, priority, notes, post-test decision and promotion/rejection remain owner
plan data. No current list of 25 Cores or spreadsheet selection is business
logic.

## Authority conflicts and deferred persistence

1. The established ten-race rule is an analytical-confidence boundary. The
   clarified twenty-observation rule is a planned normal-Free study target.
   They are related but not interchangeable.
2. Legacy broad analytical bands include source distances outside the current
   Bike owner study and historically overlap at boundary distances. They remain
   valid for their existing analyses; the new non-overlapping Bike study bands
   apply only to this configured testing workflow.
3. The current historical archive contains authoritative elapsed results but no
   race name. Current API race documents contain a name but the observed API
   still lacks authoritative finished-race time/distance outcomes. Existing
   rows therefore cannot be reclassified safely.
4. A persistence migration for evidence class and owner-plan state is deferred
   until one source provides the required joined authority and P5 permits real
   Preview persistence. Adding columns now would not make unknown legacy rows
   authoritative and would unnecessarily change the already measured P5
   storage inventory.

Until that boundary clears, the UI shows normal-Free history as unavailable and
does not publish live `TEST`/`SCREEN` rows. This is a deliberate no-fabrication
state, not a zero sample.

## Operational safeguards

Complete pagination, authoritative race-ID deduplication, observation/retrieval
timestamps, durable checkpoints, daily incremental refresh, periodic history
reconciliation, last-good publication, the 30-request/minute burst ceiling and
zero-cost provider budgets remain unchanged. Discovery does not increase sync
frequency and cannot authorize race entry, provider writes, deployment or a
Production change.
