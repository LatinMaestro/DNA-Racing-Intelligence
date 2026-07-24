# Phase 2 Current Vault Identity Resolution Contract

Date: 24 July 2026  
Status: repository domain service with synthetic verification  
Production: disabled and fail-closed

## Purpose

This service converts accepted Current Vault ownership evidence into durable Core
Details identity decisions before the Phase 2 registry, profiles, personal race
economics or recommendations use it.

Every accepted Current Vault row is owner-confirmed as owned. Maiden eligibility
is a separate state and never decides ownership. Durable Core Details IDs remain
the only authoritative identity.

## Resolution inputs

The service requires:

- an explicit snapshot-wide assertion that every accepted Vault row is owned;
- a stable private Vault entry ID;
- Vault name, class, element, F-number and sex;
- nullable/invalid Maiden source evidence;
- selected Core Details records keyed by durable ID; and
- optional prior confirmed identity signatures from earlier accepted snapshots.

Names and signatures are private processing values. Routine logs and Git fixtures
remain redacted and synthetic.

## Deterministic matching

For a row without a prior mapping:

1. normalize Unicode, surrounding/internal whitespace and name casing;
2. find Core Details rows with the exact normalized name;
3. require class, element, F-number and sex to agree;
4. confirm only one exact composite candidate;
5. leave zero, inconsistent or multiple candidates review-required.

This resolves reused names only when the remaining authoritative attributes select
exactly one durable ID. It never selects a lineage or ownership identity from a
name alone.

A prior confirmed signature may continue to resolve the same durable ID after its
Core Details display name changes, provided class, element, F-number and sex still
agree. A missing prior ID or attribute conflict fails closed into review.

If two current Vault rows resolve to the same durable ID, neither resolution is
accepted automatically. Both remain review-required as a duplicate assignment.

## Output states

Confirmed results expose:

- durable Core Details ID;
- owner-confirmed snapshot evidence;
- exact-composite or prior-confirmation match method;
- separate eligible/not-eligible/unknown/invalid Maiden state; and
- the private identity signature needed for later snapshot continuity.

Review-required results preserve sorted candidate IDs where available and one
stable reason:

- unmatched name;
- inconsistent attributes;
- ambiguous composite;
- prior mapping missing from selected Core Details;
- prior mapping conflict; or
- duplicate resolved core.

The service is deterministic across source ordering and rejects duplicate source
entry IDs, duplicate Core Details IDs and invalid ownership assertions.

## Current source evidence

The approved private aggregate profile confirms that all 195 rows in the inspected
current Vault resolve deterministically to the supplied Core Details and that the
68 eligible / 127 not-eligible Maiden states are separate from ownership. No
private identity mapping is committed.

Future unmatched, inconsistent, ambiguous or duplicate rows remain review-required
rather than weakening the matching rules.

## Integration boundary

The resolver precedes the current-Vault registry in PR #28. Its confirmed results
map to the registry's durable confirmed ID, while review-required results remain
visible ownership evidence but cannot create a durable profile, personal race P/L
or recommendation.

Persistence, owner review actions and the Data Updates interface remain later
focused slices. The first persistent private Preview import remains subject to
Gate B, and Production remains subject to Gate F.

## Verification

Synthetic tests cover:

- unique exact-composite confirmation;
- reused-name disambiguation by attributes;
- unmatched, inconsistent and ambiguous review;
- prior mapping reuse after a display-name change;
- missing and conflicting prior mappings;
- duplicate resolved-core rejection;
- deterministic output across source ordering;
- separate eligible, not-eligible, unknown and invalid Maiden states; and
- fail-closed ownership and identifier validation.
