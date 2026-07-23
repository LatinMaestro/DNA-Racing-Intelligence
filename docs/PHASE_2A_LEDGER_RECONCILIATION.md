# Phase 2A Ledger Duplicate, Reversal and Reconciliation Contract

Date: 23 July 2026  
Status: unpublished repository domain contract with synthetic verification  
Production: disabled and fail-closed

## Purpose

This Phase 2A slice defines the recoverable review layer for manual and
source-derived economic records. It prevents duplicate aggregate counting and
supports correction without deleting or silently rewriting accepted facts.

The contract remains independent of hosted persistence and the staged manual
entry validator. It accepts normalized ledger evidence and produces:

- advisory duplicate candidates;
- recoverable exclusion and restore state;
- owner-confirmed duplicate links;
- exact compensating reversal records; and
- ordered audit actions.

## Duplicate evidence

Transactions are compared only when their normalized asset and exact signed
amount agree. A credit and debit are never treated as duplicates.

Candidate reasons are:

- same stable source key;
- same external reference;
- same UTC date, exact amount and full category/tournament/core context; or
- same UTC date and exact amount with differing context.

Reference or stable-key matches receive high review priority. Same-date,
same-amount matches without matching context remain low priority. Every
candidate has `automaticExclusionAllowed: false`; a candidate never changes a
financial total until an explicit reviewed action is recorded.

Unlike assets are never compared or converted. BGC, ETH, DEZ and fiat therefore
remain separate.

## Immutable facts and recoverable overlays

An exclusion or confirmed duplicate changes only aggregate eligibility. The
original transaction and every action remain in the audit result.

A duplicate action requires:

- a distinct existing survivor;
- matching asset and exact signed amount; and
- at least one supported duplicate-evidence reason.

A later restore action can reactivate an exclusion or duplicate when new
evidence proves the records are distinct.

## Reversals

A reversal does not edit the original amount. It creates a new transaction:

- linked by `reversal:<original transaction ID>`;
- using the exact opposite signed decimal;
- dated at the recorded correction time; and
- identified as source type `reversal`.

The original is retained and labelled reversed. The original and compensating
record remain included so their exact amounts net to zero. A reversal cannot be
restored; a later correction must be another auditable record.

## Fail-closed validation

The contract rejects:

- invalid runtime source or action enums;
- blank or duplicate transaction/action IDs;
- invalid timestamps or asset codes;
- zero, exponential or malformed decimal amounts;
- duplicate core links;
- missing or self-referential duplicate survivors;
- duplicate confirmations without supported matching evidence;
- missing or reused reversal IDs;
- invalid action-specific fields; and
- a second state-changing action before an excluded transaction is restored.

## Boundaries

This slice does not:

- auto-delete, auto-exclude or auto-merge a candidate;
- persist private economic records;
- alter source-derived race facts;
- combine unlike assets;
- classify a tournament stage;
- calculate a financial dashboard;
- create wallet or game transactions;
- store crypto signing credentials; or
- change Preview, Production, provider or GitHub Actions state.

Database persistence, user review forms, campaign classification, aggregation
and dashboard reporting remain later focused Phase 2A slices.

## Synthetic validation

Tests cover:

- exact decimal normalization;
- stable-key, reference, full-context and amount-only candidates;
- asset and direction separation;
- advisory-only duplicate detection;
- confirmed duplicate overlays;
- recoverable restores;
- exact compensating reversals;
- immutable audit history; and
- fail-closed runtime and action-state boundaries.
