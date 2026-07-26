# Phase 9 hosted connected-provider preflight

This boundary records exact-head, privacy-safe provider capability evidence
without granting migration, deployment, workflow, secret or Production
authority.

## Recorded facts

- Neon uses an isolated Preview branch; the default branch remains untouched.
- Read-only capability evidence includes the PostgreSQL version,
  `row_security` state and empty public-schema count.
- No migration, write SQL or secret change is permitted by this evidence.
- The observed Vercel `main` setup targeted Production and the Gate F guard
  blocked it.
- Vercel retries remain held until the exact-head queue is validated, merged
  serially and the resulting `main` head is verified.
- Missing connected Vercel project access remains an explicit limitation.
- Production always requires separate Gate F owner approval.

Provider identifiers may be retained in the private owner handoff. Connection
strings, credentials, SQL results containing private rows and private source
data must not enter Git, CI, routine logs or public surfaces.
