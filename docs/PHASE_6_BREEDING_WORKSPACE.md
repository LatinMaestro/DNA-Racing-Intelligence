# Phase 6 Breeding Read Workspace

Status: owner-scoped historical read boundary; providers, execution and
deployment remain disabled.

## Purpose

The private Breeding route reads compact, materialized pair-ranking evidence
only after the authenticated Clerk owner matches the server-side allowlist. It
does not scan raw Race Merge, lineage or Arena history on a routine request.

## Application boundary

- Return explicit identity-disconnected and persistence-not-configured states.
- Reject malformed repository states and evidence before projection.
- Derive performance and Arena freshness from their accepted cutoffs, accepted
  import identities and server time, including exact 3/4/7/8-day boundaries.
- Reject non-canonical timestamps, future evaluations/imports/cutoffs and
  cutoffs that follow their accepted import.
- Bind labels and versioned evidence and reject duplicate ranking IDs or
  ID-to-label mappings.
- Keep the provider-neutral repository unavailable by default; no provider
  initializes at module import or build time.

## Preserved breeding rules

- Elite-upside, Vault-gap and balanced objectives remain genuinely separate.
  Vault saturation cannot suppress the elite-upside order.
- Offspring class uses the confirmed matrix, element is the lower-ranked parent
  element and F-number is the uncapped parent sum.
- Family, sex, cycle, lifetime splice capacity and availability evidence must
  all be cleared before ranking. Active owned availability may be confirmed
  upstream when no owner unavailability marker exists.
- External parents require the exact accepted Arena snapshot, a fresh cutoff
  and an unexpired listing. Imported listings are not live and do not establish
  a breeding transaction or income.
- Supported chronological parent-offspring validation is required. Star
  features remain excluded unless they demonstrate incremental holdout lift
  over a time-only baseline.
- Experimental basis-point estimates describe uncertain offspring
  distributions; they are not guaranteed outcomes or a discovered secret
  breeding formula.

All rankings remain non-actionable while Gate E is unpassed. Breeding execution,
economic writes, private-data execution, Preview activation and Production
activation remain unavailable.

## Source identity

This workspace was recomposed from queue order 18 exact source head
`c77c30b0169e2835a61c67368901d57ecc7860a9` onto verified `main`
`8a1bdd208496d44a190bd188b449e85575b6fcc3`. No staged ancestry or evidence-only
descendant was merged.
