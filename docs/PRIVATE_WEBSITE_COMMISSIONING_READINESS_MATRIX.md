# Private website commissioning readiness matrix

Status: repository-only audit at exact main `6c1b8c9687f5402dbd80912948d359f669afd3ee`, 15 October 2026.

This matrix separates code and synthetic evidence from connected owner-data acceptance. It does not prove that a hosted schema is applied, a retained record exists, a private Preview is current or any page is commissioned.

## Current safety gate

The 15 October recovery and recurring-transfer audit is recorded in
`NEON_TRANSFER_RECOVERY_AND_MONTHLY_PLAN.md`. It distinguishes independently
budgeted R2-only processing from the coupled Neon commands below; no standalone
real-data replacement or provider reset has been proved.

The latest accepted Neon metadata reports `5,695,839,591` October network-transfer bytes for the period ending `2026-11-01T00:00:00Z`. That exceeds both the owner 4.75 GB operating ceiling and the stated Free allowance. Until fresh metadata proves positive A$0 headroom for every affected provider:

- do not run owner-data SQL, connected page loads or automated page data-fetch tests;
- do not perform material R2 reads or any R2 write;
- do not deploy or replay a connected Preview; and
- continue repository, fixture, CI and metadata-only work.

The reset date is an expectation, not authorization. Every material operation requires a fresh provider gate.

## Module matrix

“Composed” means the route selects a real repository from server-only environment settings. It is not connected acceptance.

| Private module                             | Exact-main repository state                                                                     | Offline evidence available now                                                                         | Connected acceptance required later                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                                  | Composes owner Vault catalogue and import-freshness repositories                                | Identity/config/error states, bounded fake adapters, render tests                                      | Owner-isolated Vault and source-cutoff read; honest missing/stale display                                                         |
| My Vault / Core Intelligence / Search Core | Composed Neon/R2 services                                                                       | Filter/limit, parsing, owner denial and page-state tests                                               | One bounded owner snapshot per route; no catalogue scan                                                                           |
| Tournament                                 | Composed configuration and evidence services                                                    | Approved-method fixtures and eligibility/uncertainty tests                                             | Exact configuration plus owner evidence with coverage and freshness                                                               |
| Maiden                                     | Owner-scoped snapshot and route adapter; fixture-only materialization contract                               | Canonical codec, accepted coverage/CAS tests, owner isolation and migrations       | Trusted source reader, atomic publisher, reserved runner, retained-data acceptance                            |
| Bike Pro League                            | Composed services                                                                               | Roster/compliance/evidence fixtures and commissioning guards                                           | Exact serving generation, Bike-only evidence and private owner acceptance                                                         |
| Open Race                                  | Route still injects `unavailableOpenRaceWorkspaceRepository`                                    | Staged service/UI fail-closed states                                                                   | Authoritative read model only; no entry, wallet or live-API side effect                                                           |
| Discovery                                  | Composed services                                                                               | Approved-method and partial/unknown fixtures                                                           | Bounded owned-Core evidence with exact distance, sample and cutoff                                                                |
| Breeding / Splice                          | Composed services                                                                               | Ranking/viability separation and unavailable-state fixtures                                            | Retained lineage plus separately current official viability evidence                                                              |
| Vault Performance                          | Composes the compact owner-scoped summary repository                                            | Exact-decimal, owner isolation, source identity, coverage, freshness and sanitized-error guards        | Apply 0125/0126 after capacity proof, publish one accepted summary, then run bounded private acceptance; no raw-ledger page scans |
| Lifecycle                                  | Route still injects `unavailableLifecycleRankingRepository`                                     | Approved chronology/ranking fixtures and withheld states                                               | Owner-scoped point-in-time ranking evidence; no future leakage                                                                    |
| Readiness                                  | Route still injects `unavailableReadinessAssessmentRepository`                                  | Gate-state and blocked-state rendering                                                                 | Exact deployed-head, auth, provider, rollback and connected-test evidence                                                         |
| Imports                                    | Composed import-status repository                                                               | State-machine, error and provenance fixtures                                                           | Bounded status/receipt reads only; no import or acquisition in commissioning                                                      |

## Bounded connected acceptance plan

Run these steps module by module only after Neon, R2 and hosting metadata all prove the operation remains A$0 and below owner ceilings.

1. Bind the test to an unchanged reviewed main SHA whose push-triggered validation and migration jobs both passed.
2. Verify protected Preview authentication, the configured single owner, least-privilege runtime role and forced owner isolation without logging identifiers or secrets.
3. Start a read-only repeatable-read transaction. Set the owner scope, verify the authenticated owner mapping, then invoke only the module repository's compact bounded function with its repository-enforced limit. Never query raw evidence or run an unbounded table scan.
4. Record sanitized counts, coverage state, data-current-through, last-imported and warnings. Missing, partial, stale, conflicting or unsupported evidence must remain visible and must not become a recommendation, probability, EV or profit claim.
5. Exercise success, empty, partial, stale and repository-error page states against the same snapshot. Confirm responsive and keyboard/screen-reader behavior without exposing exception details.
6. Recheck provider usage after the bounded read. Stop immediately on unknown headroom, unexpected transfer, permission drift, timeout or any write attempt.

One accepted module does not authorize another; re-run the provider gate before each material operation.

## Deployment, privacy and rollback gate

A protected Preview may be commissioned only when all rows below are proven on the same unchanged main SHA.

| Gate       | Required proof                                                                                                                   | Current state                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| CI         | Push-triggered validation and full migration jobs passed                                                                         | Passed for audited SHA; must be re-proved for deployment SHA      |
| Code       | Full diff/review, dependency audit, secret scan, formatting, zero-error lint, strict TypeScript, tests, build and Worker dry-run | Required per candidate                                            |
| Capacity   | Fresh Neon transfer/storage/compute, R2 storage/Class A/Class B and hosting usage all below owner ceilings at A$0                | Blocked by Neon transfer; other live ceilings still require proof |
| Privacy    | Protected Preview, single-owner authentication, forced owner isolation, least privilege, no public indexing or raw evidence      | Not connected-proven for a current deployment                     |
| Acceptance | Every enabled module passes the bounded owner-data plan and labels exact coverage/freshness                                      | Not run while transfer is unsafe                                  |
| Rollback   | Last-good deployment identified; rollback command and health check prepared; provider state unchanged by reads                   | Must be proved before Preview                                     |
| Production | Specific owner release approval plus all gates repeated                                                                          | Not authorized                                                    |

Rollback must restore the last-good protected deployment without schema rollback or data mutation. A failed health/auth/coverage check leaves the candidate unpromoted. Production stays unchanged.
