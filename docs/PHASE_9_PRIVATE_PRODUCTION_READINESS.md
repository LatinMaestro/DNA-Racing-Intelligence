# Phase 9 Private Production Readiness

This contract aggregates the evidence required before client-only Gate F
review. Gates A–E, exact-head CI, a representative protected private import,
recovery validation, large-history capacity, security/privacy,
accessibility/responsive checks, migration safety and documented limitations
must all be resolved.

Production must remain fail-closed during assessment: no custom domain, public
route, full private Production dataset or recurring paid infrastructure may be
enabled. Missing evidence remains review-required and failed evidence blocks
readiness.

Even a complete evidence package can only become `ready_for_gate_f_review`.
Explicit owner approval may be recorded, but the contract always returns
`activationAuthorized: false` and cannot mutate or activate Production.
