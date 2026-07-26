# Economic Action Feedback Actions

## Scope

The Vault Performance, Breeding and Lifecycle Server Action modules expose
feedback-returning variants of their existing owner-authenticated economic
operations. The variants remain provider-neutral and do not enable any form,
repository, wallet, game or ownership capability.

## Translation

- `identity_not_connected` remains an owner-verification blocker.
- `persistence_not_configured` remains an explicit unavailable state.
- `recorded` and `replayed` remain distinct durable outcomes.
- held breeding evidence becomes `review_required`.
- a typed durable-identity conflict becomes `conflict`.
- every other exception becomes `unexpected_failure`.

The translation uses typed internal identity and conflict errors. It does not
inspect exception text, submitted values, arbitrary field names or provider
details.

## Request boundary

Each feedback action delegates to its existing Server Action, so Clerk identity
is resolved independently inside every invocation and checked against the
server-side owner allowlist before persistence.

The feedback response contains only reviewed copy and fixed semantic state. It
never returns a durable fingerprint, submitted economic value, raw exception,
owner identity or provider error.

## Disabled capability

Every economic repository remains explicitly unavailable. The accessible forms
remain disabled pending strict parser integration and executed forced-RLS
Preview persistence evidence. No source fact, ledger record, ownership state,
wallet, game system, provider, Preview import or Production state can change.
