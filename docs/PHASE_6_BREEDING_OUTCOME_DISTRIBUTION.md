# Phase 6 Breeding Outcome Distribution

## Purpose

Represent experimental offspring outcomes as an auditable probability
distribution rather than a deterministic quality prediction.

## Contract

- Keep weaker, comparable, stronger and exceptional outcome bands separate.
- Store probabilities and uncertainty bounds as exact integer basis points.
- Require the four probabilities to total exactly 10,000 basis points.
- Require every estimate to lie inside its uncertainty interval.
- Keep mode and exact distance explicit.
- Display `Data current through`, `Last imported`, prediction time and expected
  breeding time separately.
- Hold stale, unknown, under-sampled or unsupported calibration evidence.
- Use star features only where incremental chronological lift is supported.

## Boundaries

Even a supported distribution remains experimental before Gate E. It cannot be
described as deterministic inheritance, cannot be adjusted downward because the
vault already contains similar cores, and cannot rank or recommend a pairing.
