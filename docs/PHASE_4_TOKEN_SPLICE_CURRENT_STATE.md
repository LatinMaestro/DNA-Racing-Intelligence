# Phase 4 Token and Splice current-state materialization

## Delivered boundary

The API-only current-state path now has canonical adapters for the connected
DNA Open Lab Token and Splice shapes that have actually succeeded:

- `tokens.prices` becomes one timestamped current/reference USD-price snapshot;
- each `splice.arena` response becomes one mode-qualified page with its provider
  pagination and current listing values preserved; and
- `splice.pair_info` becomes an on-demand official parent/baby/pricing preview.

These records retain v1 endpoint authority, retrieval time, canonical entity
keys and deterministic raw-evidence checksums. Token values are explicitly
labelled `current_reference_only`; they cannot value a historical race or
transaction. Arena price fields describe a current listing and never prove a
completed splice, income, eligibility or ownership transfer.

## Complete generation rule

Token and Arena publication is all-or-nothing with the existing six-family
last-good generation:

- the Token receipt must declare exactly one complete snapshot;
- every requested Arena mode must contain pages starting at page 1 without a
  gap;
- every non-terminal page must report `has_more: true` and the final page must
  report `has_more: false`;
- a Core cannot repeat across pages for the same mode;
- flattened listing count must equal the complete `splice_arena` receipt;
- observations cannot be later than the generation cutoff; and
- endpoint, scope, entity key and checksum authority must match exactly.

An empty Arena mode is publishable only when page 1 was observed as the terminal
empty page. A rate limit, eligibility loss, API failure or interrupted page walk
therefore keeps the previous last-good generation serving.

## Deliberately separate evidence

`pair_info` is not part of the full Arena crawl or the current-family receipt.
It is a pair-specific, point-in-time preview and preserves provider parent,
baby and pricing values without asserting that the pair is valid or that a
splice will occur.

No successful `pair_validate` shape has yet been observed. The adapter does not
promote failed validation probes into eligibility facts; a successful current
validation remains a P9 dependency. Optional Splice request documents remain
deferred until a safe existing read-only request ID is available.

## Safety and next step

This slice is synthetic and local. It performs no DNA request and changes no
hosted Neon/R2 data, deployment, wallet or game state. Migration `0074` now
persists one compact Token row, expected Arena modes, page receipts and
mode/Core listing rows behind forced owner RLS. Publication rechecks exact Token
and listing counts, contiguous terminal pagination and per-page coverage; narrow
runtime reads resolve only through the last-good serving generation. Its
PostgreSQL workflow proves apply, smoke, reverse and removal. The next P4 slice
is bounded sync-worker wiring and endpoint-appropriate current-state cadence.
Persistent real owner-data sync remains blocked by the P5 owner-approval gate.
