# Staged Branch Manifest

## Purpose

This document records the unpublished, main-anchored roadmap integrations prepared while GitHub Actions runners are unavailable. It is an integration handoff, not evidence that the branches have passed exact-head CI or that any review gate beyond its recorded state is accepted.

## Repository anchor

- Repository: `LatinMaestro/DNA-Racing-Intelligence`
- Base branch: `main`
- Audited base commit: `e1b10b90d7a54e8a116f4f0e7b89bd8f3abdf49a`
- Open draft pull requests: #29 and #28
- Production: disabled and fail-closed
- Private hosted data: not accessed
- Provider, domain and paid-service state: unchanged

## Canonical phase integration branches

| Order | Phase | Branch | Head | Contracts | Changed files | PRs | PR workflow runs |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | Phase 2 analytics | `agent/integrate-phase-2-analytics` | `d4afa3f59f0b69dffea5f6fa36024c731a89e7df` | 6 | 19 | 0 | 0 |
| 2 | Phase 2A accounting | `agent/integrate-phase-2a-accounting` | `4447d4b42944c14008346fa3acf11fc5fadafd09` | 9 | 28 | 0 | 0 |
| 3 | Phase 3 Discovery | `agent/integrate-phase-3-discovery` | `98c29b3654f0dde95854464c19c485bc97364217` | 7 | 22 | 0 | 0 |
| 4 | Phase 4 tournament | `agent/integrate-phase-4-tournament` | `81b17e6a1c26d702147b1610058b656b02d79fd3` | 9 | 28 | 0 | 0 |
| 5 | Phase 5 Maiden | `agent/integrate-phase-5-maiden` | `e606517c47036c3eee07fe3195e38bec0c40b3ff` | 5 | 16 | 0 | 0 |
| 6 | Phase 6 breeding | `agent/integrate-phase-6-breeding` | `bd67834968f4e31e314257667de8d7c4d19f72f6` | 10 | 31 | 0 | 0 |
| 7 | Phase 7 lifecycle | `agent/integrate-phase-7-lifecycle` | `f70b9932d3d862764ca97f55fec25dd1a30b2bcc` | 6 | 19 | 0 | 0 |
| 8 | Phase 8 Open Race | `agent/integrate-phase-8-open-race` | `6954a4c24e2f71f73f034dd6985c70428852547c` | 6 | 19 | 0 | 0 |
| 9 | Phase 9 validation | `agent/integrate-phase-9-validation` | `129c5139861ed43698d5d9906d187346ff0be28a` | 12 | 37 | 0 | 0 |

The nine branches contain 70 standalone contracts. Across them there are 210 unique domain, synthetic-test and specification files. Including the shared decision log, the combined changed-path inventory is 211 files.

## Separate draft prerequisites

### PR #29 — TSX test discovery

- Branch head: `0a3212bc6ac63721858a03048619ad678a85286e`
- Purpose: include `tests/**/*.test.tsx` in Vitest discovery.
- Last workflow: run 79 failed before runner allocation with zero test execution.
- Required disposition: replacement exact-head CI before merge.

### PR #28 — current Vault registry

- Branch head: `8e8b51bcecb8adba9b4c34e2d90d57017113ce88`
- Purpose: establish the authoritative current-owned-core boundary and auditable Maiden overrides.
- Last workflow: run 82 failed before runner allocation with zero test execution.
- Required disposition: rebase after PR #29, then replacement exact-head CI before merge.

These draft branches are not included in the phase integration branches and must not be assumed present during their validation.

## Validation provenance

- Every standalone contract was previously checked with synthetic fixtures in the hosted workspace.
- Formatting, lint and strict TypeScript checks passed for the staged contract sets.
- Progressive cumulative hosted-workspace verification reached 430 passing tests across 49 files and a successful 14-page application build.
- Each phase integration branch was audited for clean ancestry, expected paths and byte-for-byte equality with its validated standalone source branches.
- No phase integration branch has exact-head GitHub CI. Prior hosted-workspace results are provenance, not a substitute for the mandatory replacement CI.

## Branch authority

Once Actions capacity returns, use the nine phase integration branches as the roadmap merge inputs. Retain the standalone branches for provenance and forensic comparison; do not open separate PRs for every standalone contract unless the corresponding phase integration fails composition review.
