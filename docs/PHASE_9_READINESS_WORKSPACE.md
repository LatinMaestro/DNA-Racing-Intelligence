# Phase 9 readiness workspace

## Scope

This slice adds an authenticated owner-only workspace for the existing private
Production readiness assessment. The route reports the latest accepted
exact-head evidence package and cannot mutate providers, data, routes, domains
or Production.

## Evidence boundary

The compact repository supplies one assessment containing:

- the accepted assessment version and canonical publication chronology;
- the exact 40-character repository head;
- Gates A–E;
- exact-head CI;
- representative protected private import evidence;
- recovery validation;
- large-history performance and capacity evidence;
- security and privacy evidence;
- accessibility and responsive evidence;
- reversible migration status;
- documented limitations;
- fail-closed Production controls; and
- client-only Gate F approval state.

The assessment SHA must equal the running deployment's exact
`VERCEL_GIT_COMMIT_SHA`; a claimed branch name or different head is rejected.
The accepted assessment version, evidence cutoff, assessment time and
publication time must be canonical, ordered and not in the future. Freshness is
derived server-side at the exact 3-day current, 4-to-7-day ageing and 8-day
stale boundaries. Stored freshness drift is rejected, while ageing or stale
evidence remains review-required.

Every missing check remains `review`; failed evidence and unsafe Production
state remain `block`. The domain contract always returns
`activationAuthorized: false` and `productionMutationAllowed: false`, even when
all evidence is complete.

## Safety properties

- The authenticated Clerk owner must match the server-side allowlist before any
  repository read.
- The page is an async Server Component and reads only a compact accepted
  assessment.
- The interface distinguishes passed, review-required and blocked evidence.
- Missing evidence never becomes a pass.
- An assessment cannot describe a different deployed head as current.
- Gate F remains client-only.
- The workspace has no activation action and cannot attach a domain, expose a
  route, enable recurring paid infrastructure or upload private Production
  data.
- Provider initialization, Preview and Production remain disabled.

## Validation contract

The exact integration head must pass Prettier, ESLint, strict TypeScript, all
TS/TSX tests, the optimized build and cumulative PostgreSQL migration checks.
Synthetic domain, service and rendering coverage includes fail-closed
connection states, owner authorization, deployed-head binding, accepted-version
binding, canonical chronology, future evidence, stored freshness drift, exact
3/4/7/8-day boundaries, empty/malformed evidence and disabled activation.

Source identity: queue order 21, `agent/readiness-read-workspace` at
`9a9cd34023755ebb8480e4d56f8c36c628a00957`, recomposed onto verified `main` at
`64fdc686824c38f22c96dfc325561a87a5f183d6`. Hosted results are recorded only
against the final pull-request head.
