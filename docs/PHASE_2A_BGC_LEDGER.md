# Phase 2A BGC Ledger

## Scope

This deterministic contract reports BGC as a separate in-game-credit ledger.
It supports:

- manual opening balances;
- actual manually recorded burn credits;
- actual arena-fee spend;
- signed reconciliation adjustments; and
- balanced internal transfers between labelled BGC accounts.

It does not predict burn credits, infer breeding transactions from arena
listings, initiate a game transaction or include BGC in cash/crypto profit.

## Balance integrity

One active non-negative opening balance is permitted per account. Movement is
calculated for an inclusive reporting period.

Internal transfers require two postings against distinct account labels and
must net exactly to zero. They remain visible at account level but do not change
the vault's earned, spent or net-movement totals.

A derived balance is available only when:

- recorded movement coverage is complete for the period;
- opening-balance coverage is complete and every account with included
  movement has an explicit opening record;
- no included evidence remains reconciliation-required; and
- the data-current-through timestamp is known.

Otherwise, earned, spent and adjustment evidence remains visible while the
balance is unavailable and the report is partial.

## Reporting

The summary exposes:

- opening BGC;
- BGC earned from recorded burns;
- BGC spent on recorded arena fees;
- signed adjustments;
- net BGC movement;
- account-level movement;
- derived balance where supportable;
- inclusion/exclusion and transfer-posting counts; and
- source, opening-balance, reconciliation and cutoff warnings.

The owner-confirmed `USD 1 = BGC 1` reference is exposed only as a separately
labelled equivalent where a derived BGC balance is supportable. It is never
mixed into ETH/DEZ operating P/L or total recorded crypto cashflow.

## Deferred work

Persistence, account management, manual-entry UI, core and breeding links,
dashboard presentation and hosted private data remain separate Phase 2A
slices. Exact-head GitHub CI remains mandatory before merge, and Production
remains disabled.
