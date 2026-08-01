# Phase 7 Lifecycle Workspace

Status: owner-scoped historical read boundary; providers, execution and
deployment remain disabled.

## Application boundary

The private Lifecycle route reads compact materialized action evidence only
after the authenticated Clerk owner matches the server-side allowlist. Routine
requests do not scan raw race, lineage, breeding, market or ledger history.

- Return explicit identity-disconnected and persistence-not-configured states.
- Bind evidence to the latest accepted import and all eight required versions.
- Validate canonical timestamps and reject future evaluations/imports, future
  cutoffs, post-import cutoffs and stored freshness-label inconsistencies.
- Derive current, ageing and stale states from accepted cutoffs and server time,
  including exact 3/4/7/8-day boundaries.
- Reject malformed repository evidence and duplicate core identities.
- Keep the provider-neutral repository unavailable by default so providers do
  not initialize during module import or build.

## Preserved rules

Unresolved racing, Discovery, Maiden, breeding, lineage or market value holds
every action. Genesis burn is permanently forbidden. No-star evidence alone
cannot establish burn, predicted BGC burn credit is excluded, and missing cost
basis cannot become invented sale profit. Source facts and ledger records remain
unchanged.

Every output is historical, experimental and non-actionable. Final
recommendations, automatic actions, sale, burn, game and wallet actions, ledger
mutation, provider initialization, private-data execution, Preview activation
and Production activation remain unavailable.

## Source identity

This workspace was recomposed from queue order 19 exact source head
`8ce3661b6392dd8dc23f0be207d1c75be892c1ee` onto verified `main`
`05da45d1f0e581e840b77607154f6299c5aee3cd`. No staged ancestry, queue ledger or
evidence-only descendant was merged.
