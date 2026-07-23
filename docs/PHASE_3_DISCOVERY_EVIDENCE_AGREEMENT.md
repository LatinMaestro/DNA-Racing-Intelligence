# Phase 3 Discovery Evidence Agreement

This contract classifies agreement and mismatch between direct successful-time
evidence and historical Gold/Blue supporting evidence for one exact
core × mode × distance cell.

## Boundaries

- Direct time remains primary.
- Gold eligibility, Gold assignment opportunities and Blue assignment
  opportunities remain separate.
- Repeated strong-field stars may support a positive signal.
- Repeated eligible no-star evidence against weak fields is supporting negative
  evidence only and cannot stop Discovery.
- Missing, partial, invalid, stale or unknown-cutoff evidence fails closed.
- `Data current through` and `Last imported` remain separate, ordered evidence.
- A time/star mismatch remains visible instead of being forced into a quality
  conclusion.
- The output is experimental, non-actionable and cannot confirm core quality or
  authorise an automatic stop before Gate C.

## Verification

Synthetic tests cover positive and negative agreement, time/star mismatch,
neutral star evidence, incomplete and stale inputs, denominator preservation,
impossible counts and runtime enum/threshold validation.
