# Phase 9 Hosted Identity-Lineage Attestations

## Boundary

This evidence-only contract binds durable Vault identity and Core Details
lineage integrity to one exact candidate head, reviewed identity/lineage
contracts and synthetic fixtures. It does not confirm new private mappings,
write connected persistence or infer family relationships.

Required controls cover confirmed Vault ownership, authoritative Core Details
IDs, deterministic matching evidence, confirmed-mapping reuse, 68 ME true and
127 ME false states, review only for future unmatched or ambiguous rows,
versioned Core Details persistence, parent/child graph refresh, family queries,
breeding restrictions, partial raced profiles and Arena no-history states.

## Evidence rules

- Resolve identity by authoritative Core Details ID.
- Use name, F-number, class, element and sex only as deterministic evidence.
- Never create ownership or lineage from names or composite evidence.
- Reuse confirmed durable mappings with auditable provenance.
- Preserve ME true and false independently.
- Review only future unmatched or genuinely ambiguous rows.
- Refresh parent/child edges from authoritative versioned IDs.
- Expose partial-profile and no-history states without inventing relationships.
- Use synthetic fixtures only and retain no private artifact.
- Block stale heads, manifest drift, partial checks and unsafe evidence.

## Authority

The projection cannot confirm a mapping, write connected persistence, mutate
providers, dispatch Actions, merge, expose routes or mutate Production.
Connected forced-RLS and private real-file evidence remain separately required.
