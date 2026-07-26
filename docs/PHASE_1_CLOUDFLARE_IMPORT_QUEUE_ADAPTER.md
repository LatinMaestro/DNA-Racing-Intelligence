# Phase 1 Cloudflare Import Queue Adapter

## Status

This boundary is staged and disabled. It does not create, configure, pause,
resume, purge or send to a real Cloudflare Queue and does not enable Preview or
Production.

## Contract

- One lazy producer port is bound to the authenticated owner before provider
  initialization.
- Preview work and background activation/aggregate work remain on separate
  queues.
- A queue must prove that it is active, has a consumer, has a dead-letter queue,
  and has a bounded retry count before the first send.
- Messages use JSON and contain only version, work kind, durable dispatch ID and
  an opaque owner-scope SHA-256. They contain no raw owner ID, source filename,
  row, object URL, economic value or recommendation.
- Cloudflare Queues provides at-least-once delivery. Durable repository dispatch
  claims remain authoritative for replay and idempotency; duplicate delivery
  must never duplicate activation or aggregate publication.
- Consumer implementations must handle each message independently and
  explicitly acknowledge or retry every delivery. An uncaught per-message error
  must not retry an otherwise successful batch.
- This adapter does not compute previews, activate versions, refresh aggregates,
  mutate freshness, or publish recommendations in the request path.

## Remaining evidence

- Provision the approved non-Production preview/background queues and
  dead-letter queues.
- Connect least-privilege producer and consumer bindings.
- Verify queue names, consumers, retry limits, dead-letter routing, explicit
  per-message acknowledgement, replay and poison-message handling.
- Measure backlog, message size, throughput and recovery behaviour before
  provider capacity or readiness gates can pass.
