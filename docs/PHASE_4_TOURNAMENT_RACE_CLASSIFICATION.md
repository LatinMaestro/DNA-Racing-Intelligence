# Phase 4 Tournament Race Classification

This contract classifies imported historical races into open racing, qualification,
automated rounds or finals without treating periodic imports as live tournament
state.

## Guarantees

- An authoritative source stage becomes aggregate-eligible only when the configured
  tournament rule agrees.
- A single configured match without authoritative stage evidence remains a review
  proposal.
- Overlapping rules, uncertain rules and source/configuration conflicts fail closed.
- An unmatched race remains unclassified; absence of a match is not proof of open
  racing.
- Mode, exact distance, gate count, UTC window and configured exact entry fee remain
  part of the auditable matching evidence.
- Exact decimal fee comparison does not use binary floating point.
- Every result is a historical-snapshot classification and cannot claim live
  occupancy or tournament state.

## Deferred composition

Persistence, bulk confirmation, the classification queue and campaign-report UI
remain separate focused slices. Proposed classifications must not enter campaign
totals until confirmed through the correction workflow.
