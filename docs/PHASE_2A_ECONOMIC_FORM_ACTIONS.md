# Phase 2A economic FormData Server Actions

Status: staged, provider-neutral and fail-closed.

## Purpose

This boundary connects the reviewed strict `FormData` parsers to authenticated
Server Actions without enabling any economic write. It covers:

- manual ledger evidence;
- manual tournament payouts;
- completed or refunded breeding evidence;
- offspring cost-basis assignment;
- completed core sales;
- confirmed non-Genesis burns; and
- actual post-burn BGC credits.

## Trust boundary

Every invocation resolves the current Clerk identity inside the Server Action.
The authenticated identity must exactly equal the configured owner before the
capability or parser is accessed. The browser cannot submit an owner identity.

The staged actions use an explicit unavailable capability. A verified owner
receives a stable unavailable result before parsing, and a non-owner receives a
stable denial. This keeps the existing disabled forms inert until owner-scoped,
forced-RLS Preview persistence has passed its evidence gates.

When a capability is connected later, it must provide reviewed server-side
configuration to the strict parser. Durable IDs, allowed assets, decimal
precision, ownership, completed event state, core class, burn evidence and
persisted transaction evidence remain server-owned as specified by the
operation-specific parser contracts.

## Feedback and privacy

Parser rejection becomes generic invalid-input feedback. Typed execution
outcomes are projected through the reviewed economic feedback service.
Unexpected failures are collapsed to a generic fail-closed response.

Feedback never echoes submitted values, arbitrary field names, owner
identities, fingerprints, raw exceptions or provider details.

## Deliberate exclusions

This slice does not:

- enable or bind the visible forms;
- connect a database, storage provider, queue or wallet;
- perform a game, ownership, listing, sale or burn action;
- accept predicted burn credits;
- treat Arena listings as transactions; or
- change the historical Race Merge BGC zero-economics rule.

Production remains disabled. Connected Preview evidence, reversible
PostgreSQL execution and formal acceptance remain separate gates.
