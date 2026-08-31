# Breeding Vault Coverage Strategy

Status: **owner-approved permanent breeding objective**  
Effective: **31 August 2026**

## Purpose

Breeding recommendations must not optimise only for the strongest possible child in isolation. They must also help build a **well-rounded elite Vault** that can:

- field stronger and more flexible esports rosters; and
- compete when weekly/seasonal tournaments segment leaderboards by element, bred class, F-number or combinations.

Vault coverage is therefore a third strategic layer alongside:

1. direct racer quality;
2. historical breeder quality / pair synergy; and
3. **Vault capability coverage**.

## Non-negotiable quality gate

Coverage is **post-quality strategy**, not performance evidence.

A missing Water sprinter, Freak marathoner or other capability gap must never cause a mediocre pair to become a breeding `TARGET`.

The order is:

1. qualify parents/pairs through elite racer and/or elite breeder evidence;
2. apply ancestry and official pair restrictions;
3. only among otherwise valid `TARGET`/`WATCH`/`WAIT` results, measure how the projected offspring would improve Vault coverage; and
4. use coverage to re-rank candidates **within their existing status**, never to promote a `WATCH` or `WAIT` to `TARGET`.

The default strategic blend among already-qualified pairs is:

- 80% pair quality/opportunity evidence;
- 20% Vault coverage value.

This policy is configurable, but coverage must never bypass the elite qualification gate.

## Coverage dimensions

Coverage is computed independently for every mode:

- Bike;
- Car; and
- Horse.

It is evaluated at both:

- **exact distance**; and
- **distance band**.

Confirmed distance bands:

- Sprint: 900–1400m;
- Middle: 1400–1800m;
- Marathon: 1800–2200m.

The boundary distances 1400m and 1800m intentionally belong to both adjacent bands, matching the confirmed game-rule interpretation.

For each mode/distance window the Vault checks elite-runner depth across:

### Element

- Metal;
- Fire;
- Earth;
- Water.

### Core class / breed

- Genesis;
- Morphed;
- Freak;
- X-Class.

### Combined element × class

Examples:

- Water Freak sprinter;
- Earth Morphed marathoner;
- Fire X-Class 1400m runner.

This combined view matters because tournaments may segment by combinations, not only one field at a time.

### F-number segments

F-number tournament bands are not assumed to be universal. The coverage engine accepts configurable F-number segments from current tournament/esports rules and tests the projected offspring F-number against those segments.

## Gap severity

Coverage tracks **elite racers**, not merely owned Cores.

A Core only counts toward a mode/distance capability if its direct racing evidence qualifies it as elite for that scope. Historical breeder quality alone does not fill an esports/tournament runner gap.

Default depth policy:

- exact distance: one elite Core is the minimum healthy depth;
- distance band: two elite Cores is preferred for resilience and roster flexibility.

Gap states:

- `critical`: zero elite Cores;
- `shallow`: at least one elite Core but below preferred depth; and
- `covered`: preferred elite depth is met.

These thresholds are configurable as the website learns actual esports/tournament roster needs.

## How projected offspring are used

`pair_info` remains post-quality information, but its deterministic descriptor fields are strategically useful after a pair has qualified.

The coverage layer may use:

- projected offspring element;
- projected offspring class/type; and
- projected F-number

to estimate which current Vault gaps a successful elite child would fill.

This does **not** mean the child is guaranteed to inherit elite racing ability. It only answers:

> If this already high-quality breeding hypothesis produces the exceptional child we are seeking, which strategic Vault weaknesses would that child address?

## Genesis gaps

Genesis capability remains relevant to tournament coverage, but breeding cannot create Genesis Cores.

Therefore Genesis gaps are reported for Vault/tournament planning but are marked **not fillable by breeding**. They may instead become acquisition/mint/watch-list priorities where the game permits.

## Full mode-distance integration

This strategy is applied on top of the permanent full breeding matrix.

For every observed race distance, the website builds separate Bike, Car and Horse breeding boards. Each board can then be converted into a strategic board using the current Vault elite-runner inventory.

The coverage registry must be rebuilt or incrementally refreshed from **current owned-Vault state plus the latest elite-runner assessments**. Ownership changes and newly accumulated race evidence must therefore update coverage rather than preserving stale gap assumptions.

No mode, distance, element or bred class should be omitted merely because the current Vault has no qualifying Core. Missing capability must remain visible as a gap and may correctly lead to `WAIT` until a strong enough breeding opportunity appears.

## Tournament and esports use

The coverage layer should ultimately feed three related website surfaces:

1. **Breeding** — favour elite-qualified pairings that strengthen weak Vault capability cells.
2. **Esports roster planning** — identify positions where the Vault lacks genuinely strong options rather than filling the roster with weak best-available Cores.
3. **Tournament preparation** — flag weak element/class/F-number segments before qualification windows open.

Stored full-API data should allow these gaps to be precomputed continuously. When a high-quality Arena Core becomes available, the website can immediately identify both its breeding quality and the strategic Vault gaps that a projected offspring could address.
