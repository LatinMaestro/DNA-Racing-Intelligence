BEGIN;

DO $contract$
BEGIN
  IF to_regprocedure(
       'dna.read_dna_population_race_index_published_compact_identities(uuid,text,text,integer)'
     ) IS NULL
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_population_race_index_published_compact_identities(uuid,text,text,integer)',
       'EXECUTE'
     )
     OR has_table_privilege(
       'dna_app_runtime',
       'dna.dna_population_race_index_compact_identity',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'published population compact identity read contract is invalid';
  END IF;
END
$contract$;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91180000-0000-4000-8000-000000000001', 'synthetic_published_identity_owner');

DO $seed$
DECLARE
  v_owner constant uuid := '91180000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_generation_key bigint;
BEGIN
  INSERT INTO dna.dna_population_race_index_generation (
    owner_id, generation_id, version, worker_id,
    baseline_completion_sha256, baseline_logical_request_count,
    baseline_retained_r2_bytes, baseline_omitted_identity_observation_count,
    state, last_request_ordinal, processed_receipt_count,
    processed_receipt_bytes, processed_identity_omission_count,
    finished_race_receipt_count, canonical_document_observation_count,
    unique_race_count, unique_entrant_core_count,
    started_at, updated_at, completed_at, published_at,
    storage_layout, r2_chunk_count, r2_identity_chunk_count,
    r2_compacted_race_count, r2_last_source_race_id,
    compacted_at, legacy_storage_retired_at
  ) VALUES (
    v_owner, v_generation::character(64), 1, 'synthetic-published-identity-worker',
    v_generation::character(64), 1, 10, 0,
    'published', 1, 1, 10, 0, 1, 3, 3, 0,
    '2026-09-24 14:00:00+00', '2026-09-24 14:04:00+00',
    '2026-09-24 14:03:00+00', '2026-09-24 14:04:00+00',
    'r2_chunked_v1', 1, 1, 3, 'race-3',
    '2026-09-24 14:01:00+00', '2026-09-24 14:02:00+00'
  )
  RETURNING generation_key INTO v_generation_key;

  INSERT INTO dna.dna_population_race_index_r2_chunk (
    generation_key, chunk_ordinal, object_key, body_sha256, byte_length,
    row_count, first_source_race_id, last_source_race_id, registered_at,
    identity_registered_at
  ) VALUES (
    v_generation_key, 1, 'private/population/published-identities-1.json',
    repeat('3', 64)::character(64), 512, 3, 'race-1', 'race-3',
    '2026-09-24 14:01:00+00', '2026-09-24 14:02:00+00'
  );

  INSERT INTO dna.dna_population_race_index_compact_identity (
    generation_key, source_race_id, raw_evidence_sha256
  ) VALUES
    (v_generation_key, 'race-1', decode(repeat('a', 64), 'hex')),
    (v_generation_key, 'race-2', decode(repeat('b', 64), 'hex')),
    (v_generation_key, 'race-3', decode(repeat('c', 64), 'hex'));

  INSERT INTO dna.dna_population_race_index_active (
    owner_id, generation_id, activated_at
  ) VALUES (
    v_owner, v_generation::character(64), '2026-09-24 14:04:00+00'
  );
END
$seed$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91180000-0000-4000-8000-000000000001';

DO $read$
DECLARE
  v_owner constant uuid := '91180000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_rows text[];
  v_count integer;
BEGIN
  SELECT array_agg(source_race_id ORDER BY source_race_id COLLATE "C")
  INTO v_rows
  FROM dna.read_dna_population_race_index_published_compact_identities(
    v_owner, v_generation, NULL, 2
  );

  IF v_rows IS DISTINCT FROM ARRAY['race-1','race-2']::text[] THEN
    RAISE EXCEPTION 'published compact identity first page is invalid';
  END IF;

  SELECT array_agg(source_race_id ORDER BY source_race_id COLLATE "C")
  INTO v_rows
  FROM dna.read_dna_population_race_index_published_compact_identities(
    v_owner, v_generation, 'race-2', 2
  );

  IF v_rows IS DISTINCT FROM ARRAY['race-3']::text[] THEN
    RAISE EXCEPTION 'published compact identity continuation page is invalid';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_dna_population_race_index_published_compact_identities(
    v_owner, v_generation, 'race-3', 2
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'published compact identity pagination did not terminate';
  END IF;
END
$read$;

RESET ROLE;

ROLLBACK;
