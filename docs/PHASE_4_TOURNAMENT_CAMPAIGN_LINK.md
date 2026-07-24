# Phase 4 Tournament Campaign Linking

This contract applies recoverable user-confirmed tournament links over immutable
historical race facts.

## Guarantees

- Link, correction, unlink and restore are explicit audit actions.
- Every action requires a reason, timestamp, unique identity and exact expected
  revision.
- Corrections cannot silently replace an existing link.
- Unlinking excludes the race from campaign totals without deleting its source fact.
- Restore can recover only the previously unlinked audited link.
- Source event labels and timestamps remain immutable provenance.
- Campaign links describe historical imported races and require no claim about the
  current live tournament.

## Deferred composition

Persistence, bulk confirmation, user permissions and the classification queue remain
separate focused work. The effective overlay is the only campaign attribution used by
later economic aggregation; raw source labels remain evidence, not mutable
classification fields.
