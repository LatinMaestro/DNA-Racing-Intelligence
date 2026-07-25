# Phase 9 readiness workspace

## Scope

This slice adds an authenticated owner-only workspace for the existing private
Production readiness assessment. The route reports the latest accepted
exact-head evidence package and cannot mutate providers, data, routes, domains
or Production.

## Evidence boundary

The compact repository supplies one assessment containing:

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
- Gate F remains client-only.
- The workspace has no activation action and cannot attach a domain, expose a
  route, enable recurring paid infrastructure or upload private Production
  data.
- Provider initialization, Preview and Production remain disabled.

## Hosted validation

The focused slice passes Prettier, ESLint, strict TypeScript and four synthetic
service tests covering fail-closed connection states, owner authorization,
exact-head blocker presentation, empty evidence and malformed SHA rejection.
The TSX review confirms server-only data loading, semantic disabled controls,
stable check-code keys and no client persistence path.
