BEGIN;

DO $contract$
BEGIN
  IF to_regclass('dna.dna_population_race_index_compact_identity') IS NULL
     OR to_regclass('dna.dna_population_race_index_r2_chunk') IS NULL
     OR to_regclass('dna.dna_population_race_index_race_mode_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'population R2 compaction schema contract is invalid';
  END IF;
  IF has_table_privilege(
       'dna_app_runtime',
       'dna.dna_population_race_index_compact_identity',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR has_table_privilege(
       'dna_app_runtime',
       'dna.dna_population_race_index_r2_chunk',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'population R2 compaction tables expose direct runtime access';
  END IF;
  IF has_function_privilege(
       'dna_app_runtime',
       'dna.append_dna_population_race_index_batch(uuid,text,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.append_dna_population_race_index_r2_batch(uuid,text,jsonb,jsonb,jsonb,timestamp with time zone)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'population R2 runtime append authority is invalid';
  END IF;
END
$contract$;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91130000-0000-4000-8000-000000000001', 'synthetic_population_r2_owner');

SET LOCAL app.owner_id = '91130000-0000-4000-8000-000000000001';

DO $seed$
DECLARE
  v_owner constant uuid := '91130000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_worker constant text := 'synthetic-population-r2-worker';
  v_result dna.dna_population_race_index_generation%ROWTYPE;
BEGIN
  SELECT * INTO v_result
  FROM dna.begin_dna_population_race_index_generation(
    v_owner,
    v_worker,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'baselineCompletionSha256', v_generation,
      'baselineLogicalRequestCount', 3,
      'baselineRetainedR2Bytes', 60,
      'baselineOmittedIdentityObservationCount', 0
    ),
    '2026-09-24 10:00:00+00'
  );
  IF v_result.storage_layout <> 'r2_chunked_v1' THEN
    RAISE EXCEPTION 'new population generation did not default to R2 layout';
  END IF;

  UPDATE dna.dna_population_race_index_generation
  SET storage_layout = 'legacy_neon_v1'
  WHERE owner_id = v_owner AND generation_id = v_generation::character(64);

  INSERT INTO dna.dna_population_race_index_race (
    owner_id, generation_id, source_race_id, request_ordinal, endpoint,
    observed_at, raw_evidence_sha256, mode, canonical
  ) VALUES
  (
    v_owner, v_generation::character(64), 'race-1', 1, 'races.finished',
    '2026-09-02 00:00:00+00', repeat('a', 64)::character(64), 'bike',
    jsonb_build_object(
      'sourceType', 'race_document',
      'sourceRaceId', 'race-1',
      'mode', 'bike'
    )
  ),
  (
    v_owner, v_generation::character(64), 'race-2', 1, 'races.finished',
    '2026-09-02 00:00:00+00', repeat('b', 64)::character(64), 'horse',
    jsonb_build_object(
      'sourceType', 'race_document',
      'sourceRaceId', 'race-2',
      'mode', 'horse'
    )
  );
  UPDATE dna.dna_population_race_index_generation
  SET unique_race_count = 2
  WHERE owner_id = v_owner AND generation_id = v_generation::character(64);
END
$seed$;

\if :{?skip_runtime_role}
\else
SET LOCAL ROLE dna_app_runtime;
\endif
SET LOCAL app.owner_id = '91130000-0000-4000-8000-000000000001';

DO $compact$
DECLARE
  v_owner constant uuid := '91130000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_worker constant text := 'synthetic-population-r2-worker';
  v_result dna.dna_population_race_index_generation%ROWTYPE;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM dna.read_dna_population_race_index_legacy_chunk(
    v_owner, v_generation, NULL, 5000
  );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'legacy compaction reader did not return exact unique races';
  END IF;

  SELECT * INTO v_result
  FROM dna.register_dna_population_race_index_r2_compaction_chunk(
    v_owner,
    v_worker,
    v_generation,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'chunkOrdinal', 1,
      'objectKey', 'private/population/chunk-1.json',
      'bodySha256', repeat('c', 64),
      'byteLength', 512,
      'rowCount', 2,
      'firstSourceRaceId', 'race-1',
      'lastSourceRaceId', 'race-2'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'sourceRaceId', 'race-1',
        'rawEvidenceSha256', repeat('a', 64)
      ),
      jsonb_build_object(
        'sourceRaceId', 'race-2',
        'rawEvidenceSha256', repeat('b', 64)
      )
    ),
    '2026-09-24 10:01:00+00'
  );
  IF v_result.r2_chunk_count <> 1
     OR v_result.r2_compacted_race_count <> 2
     OR v_result.r2_last_source_race_id <> 'race-2' THEN
    RAISE EXCEPTION 'R2 compaction chunk did not advance exact counts';
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
      'objectKey', 'private/population/chunk-1.json',
      'bodySha256', repeat('c', 64),
      'byteLength', 512,
      'rowCount', 2,
      'firstSourceRaceId', 'race-1',
      'lastSourceRaceId', 'race-2'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'sourceRaceId', 'race-1',
        'rawEvidenceSha256', repeat('a', 64)
      ),
      jsonb_build_object(
        'sourceRaceId', 'race-2',
        'rawEvidenceSha256', repeat('b', 64)
      )
    ),
    '2026-09-24 10:01:00+00'
  );

  BEGIN
    PERFORM *
    FROM dna.register_dna_population_race_index_r2_compaction_chunk(
      v_owner,
      v_worker,
      v_generation,
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'chunkOrdinal', 2,
        'objectKey', 'private/population/duplicate.json',
        'bodySha256', repeat('d', 64),
        'byteLength', 256,
        'rowCount', 1,
        'firstSourceRaceId', 'race-2',
        'lastSourceRaceId', 'race-2'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'sourceRaceId', 'race-2',
          'rawEvidenceSha256', repeat('b', 64)
        )
      ),
      '2026-09-24 10:01:30+00'
    );
    RAISE EXCEPTION 'overlapping R2 compaction range was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%race ranges overlap%' THEN
      RAISE;
    END IF;
  END;

  SELECT * INTO v_result
  FROM dna.finalize_dna_population_race_index_r2_compaction(
    v_owner, v_worker, v_generation, '2026-09-24 10:02:00+00'
  );
  IF v_result.storage_layout <> 'r2_chunked_v1'
     OR v_result.r2_compacted_race_count <> v_result.unique_race_count THEN
    RAISE EXCEPTION 'R2 compaction equivalence did not finalize';
  END IF;
END
$compact$;

\if :{?skip_runtime_role}
\else
RESET ROLE;
\endif
SET LOCAL app.owner_id = '91130000-0000-4000-8000-000000000001';

DO $retire$
DECLARE
  v_owner constant uuid := '91130000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_retired record;
BEGIN
  SELECT * INTO v_retired
  FROM dna.retire_dna_population_race_index_legacy_storage(
    v_owner,
    v_generation,
    '2026-09-24 10:03:00+00'
  );
  IF v_retired.compact_identity_count <> 0
     OR v_retired.r2_manifest_row_count <> 2
     OR v_retired.legacy_race_count <> 2 THEN
    RAISE EXCEPTION 'legacy retirement counts disagree';
  END IF;
  IF EXISTS (SELECT 1 FROM dna.dna_population_race_index_race) THEN
    RAISE EXCEPTION 'legacy population race payload remains after retirement';
  END IF;
  IF to_regclass('dna.dna_population_race_index_compact_identity_uidx') IS NULL THEN
    RAISE EXCEPTION 'compact race identity uniqueness index was not created';
  END IF;
END
$retire$;

\if :{?skip_runtime_role}
\else
SET LOCAL ROLE dna_app_runtime;
\endif
SET LOCAL app.owner_id = '91130000-0000-4000-8000-000000000001';

DO $identity_backfill$
DECLARE
  v_owner constant uuid := '91130000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_worker constant text := 'synthetic-population-r2-worker';
  v_result dna.dna_population_race_index_generation%ROWTYPE;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM dna.read_dna_population_race_index_r2_chunk_manifests(
    v_owner, v_generation, 0, 1
  );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'R2 identity backfill manifest was unavailable';
  END IF;

  SELECT * INTO v_result
  FROM dna.register_dna_population_race_index_compact_identity_chunk(
    v_owner,
    v_worker,
    v_generation,
    1,
    jsonb_build_array(
      jsonb_build_object(
        'sourceRaceId', 'race-1',
        'rawEvidenceSha256', repeat('a', 64)
      ),
      jsonb_build_object(
        'sourceRaceId', 'race-2',
        'rawEvidenceSha256', repeat('b', 64)
      )
    ),
    '2026-09-24 10:03:30+00'
  );
  IF v_result.r2_identity_chunk_count <> 1 THEN
    RAISE EXCEPTION 'R2 identity backfill checkpoint did not advance';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.lookup_dna_population_race_index_compact_identities(
    v_owner, v_generation, jsonb_build_array('race-1', 'race-2')
  );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'compact identity backfill lost a canonical race';
  END IF;
END
$identity_backfill$;

DO $append$
DECLARE
  v_owner constant uuid := '91130000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_worker constant text := 'synthetic-population-r2-worker';
  v_result dna.dna_population_race_index_generation%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO v_result
  FROM dna.append_dna_population_race_index_r2_batch(
    v_owner,
    v_worker,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'batchSha256', repeat('e', 64),
      'afterRequestOrdinal', 0,
      'nextRequestOrdinal', 2,
      'processedReceiptCount', 1,
      'processedReceiptBytes', 10,
      'processedIdentityOmissionCount', 0,
      'finishedRaceReceiptCount', 1,
      'canonicalDocumentObservationCount', 1,
      'documents', jsonb_build_array(jsonb_build_object(
        'requestOrdinal', 1,
        'endpoint', 'races.finished',
        'observedAt', '2026-09-02T00:01:00.000Z',
        'sourceRaceId', 'race-3',
        'rawEvidenceSha256', repeat('f', 64),
        'canonical', jsonb_build_object(
          'sourceType', 'race_document',
          'sourceRaceId', 'race-3',
          'mode', 'car'
        )
      )),
      'complete', false
    ),
    jsonb_build_array(jsonb_build_object(
      'sourceRaceId', 'race-3',
      'rawEvidenceSha256', repeat('f', 64)
    )),
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'chunkOrdinal', 2,
      'objectKey', 'private/population/chunk-2.json',
      'bodySha256', repeat('9', 64),
      'byteLength', 256,
      'rowCount', 1,
      'firstSourceRaceId', 'race-3',
      'lastSourceRaceId', 'race-3'
    ),
    '2026-09-24 10:04:00+00'
  );
  IF v_result.unique_race_count <> 3
     OR v_result.r2_compacted_race_count <> 3
     OR v_result.r2_chunk_count <> 2
     OR v_result.last_request_ordinal <> 1 THEN
    RAISE EXCEPTION 'R2-backed append did not advance without duplication';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.append_dna_population_race_index_r2_batch(
      v_owner,
      v_worker,
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'batchSha256', repeat('8', 64),
        'afterRequestOrdinal', 1,
        'nextRequestOrdinal', 3,
        'processedReceiptCount', 1,
        'processedReceiptBytes', 10,
        'processedIdentityOmissionCount', 0,
        'finishedRaceReceiptCount', 1,
        'canonicalDocumentObservationCount', 1,
        'documents', jsonb_build_array(jsonb_build_object(
          'requestOrdinal', 2,
          'endpoint', 'races.finished',
          'observedAt', '2026-09-02T00:02:00.000Z',
          'sourceRaceId', 'race-3',
          'rawEvidenceSha256', repeat('f', 64),
          'canonical', jsonb_build_object(
            'sourceType', 'race_document',
            'sourceRaceId', 'race-3',
            'mode', 'car'
          )
        )),
        'complete', false
      ),
      jsonb_build_array(jsonb_build_object(
        'sourceRaceId', 'race-3',
        'rawEvidenceSha256', repeat('f', 64)
      )),
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'chunkOrdinal', 3,
        'objectKey', 'private/population/duplicate-race-3.json',
        'bodySha256', repeat('7', 64),
        'byteLength', 256,
        'rowCount', 1,
        'firstSourceRaceId', 'race-3',
        'lastSourceRaceId', 'race-3'
      ),
      '2026-09-24 10:05:00+00'
    );
    RAISE EXCEPTION 'duplicate compact race identity was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%attempted to duplicate a race identity%' THEN
      RAISE;
    END IF;
  END;
END
$append$;

\if :{?skip_runtime_role}
\else
RESET ROLE;
\endif

ROLLBACK;
