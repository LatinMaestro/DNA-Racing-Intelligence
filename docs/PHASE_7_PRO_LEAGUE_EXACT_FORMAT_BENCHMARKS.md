# Phase 7 Pro League exact-format benchmark authority

Status: bounded reference and complete-archive spillable producers implemented;
private atomic persistence and read wiring remain the next delivery slice.

## Purpose

Pro League recommendations must compare a Core with the Bike population in the
same published race type and exact distance. A distance-only result cannot be
presented as direct evidence for a 1v1, WTA or Madness map line.

`race-archive-pro-league-exact-format.ts` reconstructs this joint key from
accepted historical race evidence and produces:

- population elapsed-time distributions for winners and Top-3 entries;
- population entry and distinct-Core sample sizes;
- median, 25th/75th percentiles, standard deviation and interquartile range;
- per-Core best, median, 10%-trimmed mean, standard deviation and IQR;
- derived speed only from authoritative exact distance and elapsed time;
- sample status and freshness;
- separately disclosed win and Top-3 counts; and
- explicit unavailable placeholders for exact-format star and opposition
  evidence that has not yet been joined at this boundary.

## Race-type authority

Race Merge `rpayout` is the owner-confirmed payout-mechanism label. It is not a
cash value and `rformat` is not substituted for it. Joint Pro League type
authority is accepted only for these mappings:

| Accepted payout label          | Gate rule                         | Published race type    |
| ------------------------------ | --------------------------------- | ---------------------- |
| `Winner Take All` or `WTA`     | 2 gates                           | `1v1`                  |
| `Winner Take All` or `WTA`     | another published even gate count | `<gates> gate WTA`     |
| `Top 3`, `Top3` or `Top Three` | a published gate count            | `<gates> gate madness` |

The derived type plus exact distance must occur in Anchor, Glory, Measure or
Miracles. Missing labels, unsupported payout mechanisms and combinations not
present in the published maps remain unavailable and are reported separately.
The producer does not generalise them into a nearby cell.

## Evidence and ranking rules

- Only Bike rows enter this Pro League producer. Horse and Car evidence remains
  available to the shared Discovery workflow but cannot affect Pro League.
- Natural race-entry identities must be unique.
- Every accepted event timestamp must be at or before the generation cutoff.
- A population cell requires at least one winning and one Top-3 observation.
  Otherwise its entries are reported as unbenchmarked and no Core profile is
  promoted for that cell.
- Fewer than ten Core observations remain `hypothesis_only`; ten or more are
  `minimally_analytical`.
- Intrinsic ranking uses time, valid speed, dispersion, sample, freshness and
  population band before result context.
- Win and Top-3 counts are descriptive supporting evidence only.
- Exact-format Gold/Blue, opposition-adjusted stars and strong-opposition facts
  remain `unavailable` until a point-in-time-safe exact-format join supplies
  them. Missing field quality is never favourable.

## Complete-archive execution

`race-archive-spillable-pro-league-exact-format.ts` applies the same contract to
an asynchronous archive without retaining the full input or a full cell in
worker memory. It:

- externally sorts and rejects duplicate natural race-entry identities before
  accepting any published cell;
- externally groups accepted evidence by published type and exact distance;
- calculates exact replay-checked winner and Top-3 distributions from bounded
  scratch runs;
- externally regroups each cell by Core for exact per-Core statistics;
- emits benchmark then profile rows as a single-use stream; and
- owns and removes every scratch run after success, failure, early iterator
  return or explicit pre-read cleanup.

The in-memory record ceiling controls sort chunks rather than the archive size.
Independent observation, run-object, benchmark and profile bounds remain
fail-closed. Reference-equivalence tests cover multiple merge passes,
analytical samples, unavailable cells, audit counts, duplicates, future data
and cleanup.

## Remaining boundary

The next slice must add compact owner-isolated Preview persistence and serve the
exact-format read model. It must stage the entire benchmark/profile stream,
validate exact counts and a deterministic generation identity, activate it
atomically only after the complete generation succeeds, and keep serving the
prior last-good generation when reconstruction or publication fails.
