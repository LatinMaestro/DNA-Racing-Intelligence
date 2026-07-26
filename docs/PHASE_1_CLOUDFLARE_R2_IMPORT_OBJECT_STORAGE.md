# Phase 1 Cloudflare R2 Import Object Storage

## Status

This boundary is staged and disabled. It does not provision Cloudflare R2,
create credentials, configure CORS, expose a bucket, upload a private source
file, or enable Preview or Production.

## Contract

- The service is bound to one authenticated owner before a provider port can
  initialize.
- The configured bucket must prove that public access, `r2.dev`, and custom
  domains are all disabled before signed upload, HEAD, or GET operations.
- Direct browser uploads use short-lived signed PUT targets on the exact
  account-scoped R2 S3 endpoint. A public host, custom domain, embedded
  credential, non-HTTPS URL, or unexpected object path fails closed.
- Object keys use an opaque SHA-256 owner prefix and repository-issued durable
  upload-file ID under the immutable `quarantine/` boundary. Original filenames
  and raw owner identifiers never enter the key.
- HEAD can establish private object presence, advertised byte length, content
  type, and object version. A provider SHA-256 may be absent.
- GET returns an async byte stream. It does not buffer the complete object.
  Exact byte-length and SHA-256 validation remains the responsibility of the
  existing background raw-object stream verifier before staging can commit.
- The adapter exposes no LIST, DELETE, public URL, bucket mutation, lifecycle,
  CORS, or Production operation.

## Configuration boundary

The concrete S3 signer/client is injected through a lazy port. Missing account
or bucket identifiers return an unconfigured state, and no module import
initializes a provider. Credentials remain server-only provider configuration
and are intentionally absent from this repository.

## Remaining evidence

- Confirm the approved private R2 bucket configuration and CORS allowlist in a
  hosted non-Production environment.
- Connect least-privilege object read/write credentials.
- Exercise signed PUT, HEAD, streaming GET, checksum mismatch, truncation,
  retry, quarantine retention, and rollback against the real provider.
- Measure retained object capacity and bounded-memory processing before the
  relevant readiness gate can pass.
