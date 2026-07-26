# Phase 9 Hosted Freshness Attestations

## Boundary

This evidence-only contract binds source freshness, accepted-version state and
historical-snapshot wording to one exact candidate head, one reviewed source
contract and one synthetic-fixture manifest. It does not connect persistence,
activate imports or claim live DNA Racing data.

Required controls cover accepted-version timestamps, latest accepted event
current-through values, aggregate-refresh publication, failed-attempt
non-advancement, rollback restoration, Core Details/Vault/Arena/Race source and
mode coverage, non-live wording, freshness confidence, provenance visibility and
idempotent rebuilds.

## Evidence rules

- Retain import, latest accepted event and aggregate refresh timestamps.
- Advance freshness only after accepted activation and aggregate publication.
- Never advance freshness for previewed, failed, quarantined or rejected input.
- Restore the prior accepted version and timestamps after rollback.
- Report source-specific coverage without collapsing Bike, Car and Horse.
- Display `Data current through`, `Last imported` and explicit snapshot status.
- Reflect ageing, stale and unknown evidence in confidence and warnings.
- Preserve accepted-version provenance through replay and aggregate rebuilds.
- Bind fixed commands, manifests, exact UTC bounds and complete assertions.
- Use synthetic fixtures only; retain no private artifact.
- Require connected evidence for persistence-backed controls.
- Block stale heads, manifest drift, partial checks and unsafe evidence.

## Authority

The projection cannot dispatch Actions, merge, connect providers, activate
source versions, mutate freshness or change Production. Connected persistence
and private chronological evidence remain unclaimed until protected Preview
evidence exists.
