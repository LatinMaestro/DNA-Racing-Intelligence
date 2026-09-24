BEGIN;

DO $contract$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'dna_population_race_index_generation',
    'dna_population_race_index_batch_receipt',
    'dna_population_race_index_race',
    'dna_population_race_index_entrant',
    'dna_population_race_index_active'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class relation
      WHERE relation.oid = format('dna.%I', v_table)::regclass
        AND relation.relrowsecurity AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'population race index relation % lacks forced RLS', v_table;
    END IF;
    IF has_table_privilege('dna_app_runtime', format('dna.%I', v_table), 'SELECT')
       OR has_table_privilege('dna_app_runtime', format('dna.%I', v_table), 'INSERT')
       OR has_table_privilege('dna_app_runtime', format('dna.%I', v_table), 'UPDATE')
       OR has_table_privilege('dna_app_runtime', format('dna.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'population race index relation % exposes direct runtime access', v_table;
    END IF;
  END LOOP;
END
$contract$;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91120000-0000-4000-8000-000000000001', 'synthetic_population_race_index_owner');

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91120000-0000-4000-8000-000000000001';

DO $workflow$
DECLARE
  v_owner constant uuid := '91120000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('1', 64);
  v_result dna.dna_population_race_index_generation%ROWTYPE;
  v_batch jsonb;
BEGIN
  SELECT * INTO v_result FROM dna.begin_dna_population_race_index_generation(
    v_owner,
    'synthetic-population-index-worker',
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'baselineCompletionSha256', v_generation,
      'baselineLogicalRequestCount', 2,
      'baselineRetainedR2Bytes', 30,
      'baselineOmittedIdentityObservationCount', 0
    ),
    '2026-09-24 03:00:00+00'
  );
  IF v_result.state <> 'staging' OR v_result.last_request_ordinal <> 0 THEN
    RAISE EXCEPTION 'population race index did not begin at the immutable origin';
  END IF;

  v_batch := jsonb_build_object(
    'version', 1,
    'generationId', v_generation,
    'batchSha256', repeat('2', 64),
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
      'observedAt', '2026-09-02T00:00:00.000Z',
      'sourceRaceId', 'race-1',
      'rawEvidenceSha256', repeat('3', 64),
      'canonical', jsonb_build_object(
        'sourceType', 'race_document',
        'sourceRaceId', 'race-1',
        'mode', 'bike',
        'entrantCoreIds', jsonb_build_array('core-1', 'core-2')
      )
    )),
    'complete', false
  );
  SELECT * INTO v_result FROM dna.append_dna_population_race_index_batch(
    v_owner, 'synthetic-population-index-worker', v_batch,
    '2026-09-24 03:01:00+00'
  );
  IF v_result.last_request_ordinal <> 1 OR v_result.unique_race_count <> 1
     OR v_result.unique_entrant_core_count <> 2 THEN
    RAISE EXCEPTION 'population race index first checkpoint is invalid';
  END IF;
  PERFORM * FROM dna.append_dna_population_race_index_batch(
    v_owner, 'synthetic-population-index-worker', v_batch,
    '2026-09-24 03:01:00+00'
  );

  BEGIN
    PERFORM * FROM dna.append_dna_population_race_index_batch(
      v_owner,
      'synthetic-population-index-worker',
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'batchSha256', repeat('6', 64),
        'afterRequestOrdinal', 1,
        'nextRequestOrdinal', 3,
        'processedReceiptCount', 1,
        'processedReceiptBytes', 20,
        'processedIdentityOmissionCount', 0,
        'finishedRaceReceiptCount', 1,
        'canonicalDocumentObservationCount', 1,
        'documents', jsonb_build_array(jsonb_build_object(
          'requestOrdinal', 2,
          'endpoint', 'races.docs',
          'observedAt', '2026-09-02T00:01:00.000Z',
          'sourceRaceId', 'race-invalid-entrant',
          'rawEvidenceSha256', repeat('7', 64),
          'canonical', jsonb_build_object(
            'sourceType', 'race_document',
            'sourceRaceId', 'race-invalid-entrant',
            'mode', 'horse',
            'entrantCoreIds', jsonb_build_array(jsonb_build_object('id', 'core-3'))
          )
        )),
        'complete', true
      ),
      '2026-09-24 03:01:30+00'
    );
    RAISE EXCEPTION 'non-string entrant identity was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%document authority is invalid%' THEN
      RAISE;
    END IF;
  END;

  SELECT * INTO v_result FROM dna.append_dna_population_race_index_batch(
    v_owner,
    'synthetic-population-index-worker',
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'batchSha256', repeat('4', 64),
      'afterRequestOrdinal', 1,
      'nextRequestOrdinal', 3,
      'processedReceiptCount', 1,
      'processedReceiptBytes', 20,
      'processedIdentityOmissionCount', 0,
      'finishedRaceReceiptCount', 1,
      'canonicalDocumentObservationCount', 1,
      'documents', jsonb_build_array(jsonb_build_object(
        'requestOrdinal', 2,
        'endpoint', 'races.docs',
        'observedAt', '2026-09-02T00:01:00.000Z',
        'sourceRaceId', 'race-2',
        'rawEvidenceSha256', repeat('5', 64),
        'canonical', jsonb_build_object(
          'sourceType', 'race_document',
          'sourceRaceId', 'race-2',
          'mode', 'horse',
          'entrantCoreIds', jsonb_build_array('core-2', 'core-3')
        )
      )),
      'complete', true
    ),
    '2026-09-24 03:02:00+00'
  );
  IF v_result.state <> 'complete' OR v_result.last_request_ordinal <> 2
     OR v_result.processed_receipt_bytes <> 30
     OR v_result.unique_race_count <> 2
     OR v_result.unique_entrant_core_count <> 3 THEN
    RAISE EXCEPTION 'population race index completion did not reconcile';
  END IF;

  SELECT * INTO v_result FROM dna.publish_dna_population_race_index_generation(
    v_owner, 'synthetic-population-index-worker', v_generation,
    '2026-09-24 03:03:00+00'
  );
  IF v_result.state <> 'published' THEN
    RAISE EXCEPTION 'population race index did not publish atomically';
  END IF;
END
$workflow$;

RESET ROLE;

DO $active_pointer$
BEGIN
  IF (SELECT generation_id::text FROM dna.dna_population_race_index_active
      WHERE owner_id = '91120000-0000-4000-8000-000000000001') <> repeat('1', 64) THEN
    RAISE EXCEPTION 'population race index active pointer is invalid';
  END IF;
END
$active_pointer$;

ROLLBACK;
