# Phase 9 Hosted End-to-End Attestations

## Boundary

This evidence-only contract binds browser-level private-workspace journeys to one
exact candidate head, one reviewed route manifest and one synthetic-fixture
manifest. It does not execute a browser, configure a provider or mutate data.

Required journeys cover fail-closed access, import upload/preview/confirmation,
processing/completion/recovery, intelligence reads, tournaments/Maiden,
breeding/lifecycle, Vault Performance economics, the Open Race stage boundary
and the non-activating readiness workspace.

## Evidence rules

- Use only fixed reviewed command identities.
- Record exact UTC bounds, complete checkpoints and a redacted summary digest.
- Require browser execution and owner-boundary verification.
- Use synthetic fixtures only and retain no private artifact.
- Require connected evidence for provider-backed persistence journeys.
- Treat missing journeys as review-required.
- Block stale heads, manifest drift, failed or partial journeys, private-data
  observation, unconnected provider claims, public exposure and Production
  mutation.

## Authority

The projection cannot dispatch Actions, merge, mutate providers, expose routes
or change Production. Actual browser and connected-provider execution remain
unclaimed until protected Preview evidence exists.
