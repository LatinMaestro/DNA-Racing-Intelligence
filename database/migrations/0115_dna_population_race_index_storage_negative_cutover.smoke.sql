BEGIN;

DO $contract$
BEGIN
  IF to_regprocedure('dna.retire_dna_population_race_index_chunk_rows()') IS NULL
     OR to_regprocedure('dna.finalize_dna_population_race_index_storage_negative_cutover(uuid,text,text,timestamp with time zone)') IS NULL
     OR to_regprocedure('dna.retire_dna_population_race_index_storage_negative_legacy(uuid,text,timestamp with time zone)') IS NULL
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.finalize_dna_population_race_index_storage_negative_cutover(uuid,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'PUBLIC',
       'dna.retire_dna_population_race_index_chunk_rows()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'population storage-negative cutover contract is invalid';
  END IF;
END
$contract$;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91150000-0000-4000-8000-000000000001', 'synthetic_storage_negative_owner');

SET LOCAL app.owner_id = '91150000-0000-4000-8000-000000000001';

DO $seed$
DECLARE
  v_owner constant uuid := '91150000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_result dna.dna_population_race_index_generation%ROWTYPE;
BEGIN
  SELECT * INTO v_result
  FROM dna.begin_dna_population_race_index_generation(
    v_owner,
    'synthetic-storage-negative-worker',
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'baselineCompletionSha256', v_generation,
      'baselineLogicalRequestCount', 2,
      'baselineRetainedR2Bytes', 20,
      'baselineOmittedIdentityObservationCount', 0
    ),
    '2026-09-24 12:00:00+00'
  );

  UPDATE dna.dna_population_race_index_generation
  SET storage_layout = 'legacy_neon_v1', unique_race_count = 2
  WHERE owner_id = v_owner
    AND generation_id = v_generation::character(64);

  INSERT INTO dna.dna_population_race_index_race (
    owner_id, generation_id, source_race_id, request_ordinal, endpoint,
    observed_at, raw_evidence_sha256, mode, canonical
  ) VALUES
  (
    v_owner, v_generation::character(64), 'race-1', 1, 'races.finished',
    '2026-09-02 00:00:00+00', repeat('a', 64)::character(64), 'bike',
    jsonb_build_object('sourceType', 'race_document', 'sourceRaceId', 'race-1', 'mode', 'bike')
  ),
  (
    v_owner, v_generation::character(64), 'race-2', 2, 'races.finished',
    '2026-09-02 00:00:01+00', repeat('b', 64)::character(64), 'horse',
    jsonb_build_object('sourceType', 'race_document', 'sourceRaceId', 'race-2', 'mode', 'horse')
  );
END
$seed$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91150000-0000-4000-8000-000000000001';

DO $cutover$
DECLARE
  v_owner constant uuid := '91150000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_worker constant text := 'synthetic-storage-negative-worker';
  v_result dna.dna_population_race_index_generation%ROWTYPE;
  v_count bigint;
BEGIN
  SELECT * INTO v_result
  FROM dna.register_dna_population_race_index_r2_compaction_chunk(
    v_owner,
    v_worker,
    v_generation,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'chunkOrdinal', 1,
      'objectKey', 'private/population/storage-negative-1.json',
      'bodySha256', repeat('c', 64),
      'byteLength', 512,
      'rowCount', 2,
      'firstSourceRaceId', 'race-1',
      'lastSourceRaceId', 'race-2'
    ),
    jsonb_build_array(
      jsonb_build_object('sourceRaceId', 'race-1', 'rawEvidenceSha256', repeat('a', 64)),
      jsonb_build_object('sourceRaceId', 'race-2', 'rawEvidenceSha256', repeat('b', 64))
    ),
    '2026-09-24 12:01:00+00'
  );

  SELECT count(*) INTO v_count
  FROM dna.read_dna_population_race_index_legacy_chunk(
    v_owner, v_generation, NULL, 1
  );
  IF v_count <> 0 OR v_result.r2_compacted_race_count <> 2 THEN
    RAISE EXCEPTION 'verified R2 registration did not atomically retire exact legacy rows';
  END IF;

  PERFORM *
  FROM dna.register_dna_population_race_index_r2_compaction_chunk(
    v_owner,
    v_worker,
    v_generation,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'chunkOrdinal', 1,
      'objectKey', 'private/population/storage-negative-1.json',
      'bodySha256', repeat('c', 64),
      'byteLength', 512,
      'rowCount', 2,
      'firstSourceRaceId', 'race-1',
      'lastSourceRaceId', 'race-2'
    ),
    jsonb_build_array(
      jsonb_build_object('sourceRaceId', 'race-1', 'rawEvidenceSha256', repeat('a', 64)),
      jsonb_build_object('sourceRaceId', 'race-2', 'rawEvidenceSha256', repeat('b', 64))
    ),
    '2026-09-24 12:01:00+00'
  );

  SELECT * INTO v_result
  FROM dna.finalize_dna_population_race_index_storage_negative_cutover(
    v_owner, v_worker, v_generation, '2026-09-24 12:02:00+00'
  );
  IF v_result.storage_layout <> 'r2_chunked_v1'
     OR v_result.r2_compacted_race_count <> v_result.unique_race_count THEN
    RAISE EXCEPTION 'storage-negative equivalence did not finalize';
  END IF;
END
$cutover$;

RESET ROLE;
SET LOCAL app.owner_id = '91150000-0000-4000-8000-000000000001';

DO $retire$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO v_result
  FROM dna.retire_dna_population_race_index_storage_negative_legacy(
    '91150000-0000-4000-8000-000000000001',
    repeat('1', 64),
    '2026-09-24 12:03:00+00'
  );
  IF v_result.generation_count <> 1
     OR v_result.compact_identity_count <> 0
     OR v_result.r2_manifest_row_count <> 2
     OR v_result.legacy_race_count <> 0 THEN
    RAISE EXCEPTION 'storage-negative legacy retirement counts disagree';
  END IF;
END
$retire$;

DO $post_cutover_chunk$
DECLARE
  v_generation_key bigint;
BEGIN
  SELECT generation_key INTO STRICT v_generation_key
  FROM dna.dna_population_race_index_generation
  WHERE owner_id = '91150000-0000-4000-8000-000000000001'::uuid;

  INSERT INTO dna.dna_population_race_index_r2_chunk (
    generation_key, chunk_ordinal, object_key, body_sha256, byte_length,
    row_count, first_source_race_id, last_source_race_id, registered_at,
    identity_registered_at
  ) VALUES (
    v_generation_key, 2, 'private/population/post-cutover.json', repeat('d', 64),
    256, 1, 'race-3', 'race-3', '2026-09-24 12:04:00+00',
    '2026-09-24 12:04:00+00'
  );
END
$post_cutover_chunk$;

ROLLBACK;
