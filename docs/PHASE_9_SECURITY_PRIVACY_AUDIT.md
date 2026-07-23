# Phase 9 Security and Privacy Audit

This contract requires one evidence record for every mandatory private-product
control: fail-closed single-user authentication, owner allowlisting, private
routes, forced owner row-level security, revoked public database access,
private object storage, client-secret protection, redacted logging, repository
hygiene, prohibition on signing secrets, no indexing and dependency/configuration
review.

Unknown evidence remains review-required and any failed control blocks the
audit. Verified or failed states require an explicit evidence note, and every
control must appear exactly once so omissions cannot be hidden.

The contract cannot activate Production, expose a public route, collect a
secret or enable a paid service. A clean synthetic suite validates audit
behaviour only; Gate F remains client-only.
