# Breeding Runtime Policy

Status: **owner-approved permanent foundation**  
Effective: **31 August 2026**

This policy supersedes earlier research wording that automatically capped first-race chronology at WATCH. The owner has approved first recorded race as a sufficient modelling chronology anchor when authoritative `minted_at` is unavailable.

## Scope

The breeding recommendation methodology applies to **Bike, Car and Horse**. It is not limited to the Bike 1000–1400 research exercise.

Every recommendation is evaluated for an explicit `(mode, distance)` scope. The permanent domain contracts accept any positive race distance exposed by DNA. Current historical data contains standard distances from **900m through 2300m in 100m increments** across all three modes.

The completed website must analyse the **full mode-distance matrix**, not a hand-picked list of scopes. The runtime takes the union of every observed race distance in stored data and crosses it with all three modes (`bike`, `car`, `horse`). Every resulting scope receives its own breeding-intelligence board. If a mode has no usable evidence at an observed distance, that scope still exists and returns `WAIT` rather than being silently omitted. Newly observed distances must automatically expand the matrix without a code change. With the currently observed 900–2300m standard set, that means **45 distinct breeding-analysis scopes** (15 distances × 3 modes).

The same methodology applies at every scope:

1. assess the Core's own exact-distance racing quality;
2. assess historical offspring quality at the same mode/distance where sufficient evidence exists;
3. learn the expected offspring distribution from earlier comparable matings;
4. calculate offspring lift versus that empirical mating expectation;
5. decompose repeated lift into individual parent breeder effect and pair-specific synergy;
6. require sample depth and co-parent diversity before promoting breeder evidence;
7. keep confidence separate from quality;
8. apply family/official pair restrictions;
9. allow `WAIT` when no elite-quality pairing is available; and
10. treat `pair_info` element/F-number/type and price as post-quality information only.

Mode-wide breeder evidence may support a recommendation when exact-distance breeder evidence is sparse, but it must never override adequate negative exact-distance evidence.

## Vault and Arena equality

`source = vault | arena` is operational metadata, not a quality input.

Owned Vault Cores and current Arena Cores are evaluated under the **same racer and breeder gates**. Arena availability does not earn ranking points; an Arena Core must be good enough on evidence to deserve breeding.

A current Arena Core may qualify through:

- elite direct racing performance;
- elite historical breeder effect despite average own racing;
- both (dual); or
- a WATCH state when evidence is promising but insufficient.

The system must never force an Arena recommendation simply because a Core is available.

## First-race chronology policy

The owner has approved the offspring's **first recorded race** as a sufficient chronology anchor when authoritative splice `minted_at` time is unavailable.

Rules:

- retain `creationAuthority = first_race_proxy` so the approximation is transparent;
- freeze the mating expectation no later than the first-race timestamp;
- never use the offspring's own later performance to build its pre-offspring mating expectation;
- never use later offspring or later parent evidence to improve an earlier mating prediction;
- keep an explicit warning that first race may occur after the true breed/mint time; and
- do **not** automatically cap otherwise qualifying breeder evidence at WATCH solely because first-race chronology was used.

Unknown chronology remains insufficient for elite-breeder TARGET modelling.

## Persistent-data architecture for the completed website

The preferred production architecture is to store and incrementally refresh the full read-only API dataset so breeding analysis is primarily an **offline database/analytics operation**, not a fresh deep API crawl every time the Arena changes.

Persist, at minimum:

- Core identity and mode-specific current strength;
- full mode/distance race history and derived elapsed-time/speed benchmarks;
- lineage and parent-child graph;
- offspring first-race chronology;
- mode/distance racer-quality ratings;
- mode/distance breeder-effect ratings;
- mode/distance pair-synergy evidence;
- sample/confidence/freshness metadata;
- current Vault ownership;
- current Splice Arena availability/listing state; and
- official pair validation / `pair_info` only when needed for surviving pair candidates.

With this data stored, the website can maintain a **precomputed breeding watch registry** for known Cores even while they are not in the Arena. When Arena listings refresh, the online step becomes a fast join:

`current Arena availability × precomputed racer/breeder ratings × owner Vault candidates`

This allows rapid action when a previously identified elite racer or elite breeder enters the Arena. A Core that an owner never lists remains unavailable; the system cannot infer future willingness to offer it.

## Research census interpretation

The August 2026 lineage-first research census produced a **1,337-Core analytical universe**:

- 266 unique target parents after de-duplicating the owner's current Vault and the three current Splice Arena mode listings;
- 669 discovered offspring of those target parents within the scanned HID range;
- target-parent/offspring overlap is allowed because a Core may itself be both a child and a parent;
- those target parents plus offspring form an 812-Core primary universe; and
- 525 additional co-parents were added because they were the other parent of a discovered child but were not already in the 812-Core set.

The 525 co-parents are essential controls: without their racing history, an elite mate could incorrectly make the target parent look like a great breeder.

The complete historical backfill for the combined parent/offspring/co-parent universe captured **632,445 mode-labelled race records** with no acquisition errors or truncation in the completed shards.

## Availability versus quality

The long-term system should pre-identify excellent Cores regardless of current Arena availability, but only recommend an actionable splice when the required parent is actually available and the official pair restrictions pass.
