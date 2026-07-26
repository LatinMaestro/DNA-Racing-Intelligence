# Phase 9 hosted privacy attestation

Status: synthetic, non-executable evidence contract.

## Purpose

Replace one bare privacy-scan pass flag with exact-head attestations for:

- the current repository tree;
- the candidate diff;
- reachable Git history;
- synthetic fixture provenance; and
- retained logs, summaries and build artifacts.

Each scope uses a reviewed fixed command identifier and records exact UTC
execution bounds, exit status, scope and redacted-summary digests, finding
count, coverage completeness and explicit private-data controls.

Missing scopes remain review-required. Stale heads, command substitution,
failed or incomplete scans, any finding, unredacted output, observed or retained
private material and non-synthetic fixtures block the projection.

The contract does not retain scan output or private artifacts and cannot
dispatch Actions, merge a pull request or mutate Production.
