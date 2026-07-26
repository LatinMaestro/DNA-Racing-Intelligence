# Phase 6 Breeding Economic FormData

## Scope

This boundary parses manual completed/refunded breeding evidence and offspring
cost-basis requests without enabling either visible form or connecting
persistence.

## Manual breeding evidence

- Reject unknown, duplicate and non-text fields.
- Require an explicit-offset occurrence timestamp, two distinct parent IDs, a
  completed/refunded lifecycle and a matching economic category.
- Generate both the evidence ID and economic transaction ID server-side.
- Resolve asset kind from reviewed server configuration and keep BGC separate.
- Derive debit/credit direction from the category.
- Require a manual audit note and preserve an optional external reference.
- Permit no Arena-listing, pending or incomplete activity through this form.

## Offspring cost basis

- Generate the assignment ID and request time server-side.
- Resolve confirmed ownership and completed breeding-event evidence from
  server-supplied records.
- Accept only selected durable transaction references from the browser.
- Resolve exact category, source, status, asset and amount from confirmed
  server-side cost/refund evidence.
- Require all selected transactions to belong to the same breeding event and
  include at least one confirmed cost.
- Delegate exact BGC separation, refund matching, over-refund checks and
  original-asset totals to the authoritative cost-basis domain.
- Leave cross-assignment duplicate discovery to the existing owner-scoped
  repository service rather than trusting the request.

## Deferred activation

The disabled form shell must be aligned to this boundary before activation:
browser-supplied durable transaction IDs for new evidence and restated
cost-basis amounts are not accepted. Accessible action feedback, forced-RLS
Preview persistence, provider evidence and exact-head CI remain required. This
slice cannot initiate a splice, wallet, game, ownership or Production action.
