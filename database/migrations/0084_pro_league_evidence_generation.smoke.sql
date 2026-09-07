BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('84000000-0000-4000-8000-000000000001', 'synthetic_evidence_owner'),
  ('84000000-0000-4000-8000-000000000002', 'synthetic_evidence_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at, maximum_accepted_event_at,
  dataset_current_through_after_import, source_rows, accepted_rows,
  rejected_rows, warning_rows
) VALUES (
  '84000000-0000-4000-8000-000000000101',
  '84000000-0000-4000-8000-000000000001',
  'race_merge', 'synthetic-evidence.csv', repeat('8', 64),
  'utf_8', 'race-merge/v1', 'accepted', '2026-09-07T00:00:00Z',
  '2026-09-07T00:01:00Z', '2026-09-07T00:00:30Z',
  '2026-09-07T00:00:30Z', '2026-09-07T00:00:30Z', 6, 6, 0, 0
);
INSERT INTO dna.dataset_version (
  id, owner_id, source_type, version_number, import_batch_id,
  activated_at, data_current_through, is_active
) VALUES (
  '84000000-0000-4000-8000-000000000201',
  '84000000-0000-4000-8000-000000000001',
  'race_merge', 1, '84000000-0000-4000-8000-000000000101',
  '2026-09-07T00:02:00Z', '2026-09-07T00:00:30Z', true
);

DO $privileges$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.pro_league_evidence_generation', 'SELECT')
     OR has_table_privilege('dna_app_runtime', 'dna.pro_league_evidence_stage_row', 'SELECT')
     OR has_table_privilege('dna_app_runtime', 'dna.pro_league_evidence_row', 'SELECT')
     OR has_table_privilege('dna_app_runtime', 'dna.pro_league_evidence_active', 'SELECT')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.begin_pro_league_evidence_generation(uuid,uuid,uuid,text,character,timestamp with time zone,bigint,bigint,bigint,bigint,bigint,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.stage_pro_league_evidence_rows(uuid,uuid,text,text,integer,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.publish_pro_league_evidence_generation(uuid,uuid,text,integer,integer,bigint,character,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.read_active_pro_league_evidence_generation(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.list_active_pro_league_evidence_rows(uuid,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Pro League evidence runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '84000000-0000-4000-8000-000000000001';
DO $lifecycle$
DECLARE
  v_owner constant uuid := '84000000-0000-4000-8000-000000000001';
  v_generation constant uuid := '84000000-0000-4000-8000-000000000301';
  v_partial constant uuid := '84000000-0000-4000-8000-000000000302';
  v_source_sha character(64);
  v_digest character(64);
  v_disposition text;
  v_count integer;
BEGIN
  SELECT dna.active_pro_league_source_version_set_sha256(v_owner) INTO v_source_sha;
  SELECT dna.begin_pro_league_evidence_generation(
    v_owner, v_generation, '84000000-0000-4000-8000-000000000201',
    'synthetic-evidence-worker', v_source_sha, '2026-09-07T01:00:00Z',
    6, 4, 1, 1, 0, 0
  ) INTO v_disposition;
  IF v_disposition <> 'staging' THEN
    RAISE EXCEPTION 'Pro League evidence generation did not begin';
  END IF;
  PERFORM dna.stage_pro_league_evidence_rows(
    v_owner, v_generation, 'synthetic-evidence-worker', 'benchmark', 0,
    '[{"naturalKey":"[\"1v1\",1000]","payload":{"raceType":"1v1","distanceMetres":1000}}]'::jsonb
  );
  PERFORM dna.stage_pro_league_evidence_rows(
    v_owner, v_generation, 'synthetic-evidence-worker', 'profile', 0,
    '[{"naturalKey":"[\"core-1\",\"1v1\",1000]","payload":{"sourceCoreId":"core-1","raceType":"1v1","distanceMetres":1000}},{"naturalKey":"[\"core-2\",\"1v1\",1000]","payload":{"sourceCoreId":"core-2","raceType":"1v1","distanceMetres":1000}}]'::jsonb
  );
  -- Exact replay is resumable and must not duplicate staged rows.
  PERFORM dna.stage_pro_league_evidence_rows(
    v_owner, v_generation, 'synthetic-evidence-worker', 'profile', 0,
    '[{"naturalKey":"[\"core-1\",\"1v1\",1000]","payload":{"sourceCoreId":"core-1","raceType":"1v1","distanceMetres":1000}},{"naturalKey":"[\"core-2\",\"1v1\",1000]","payload":{"sourceCoreId":"core-2","raceType":"1v1","distanceMetres":1000}}]'::jsonb
  );
  WITH family AS (
    SELECT expected.family, expected.position, count(row.ordinal)::integer AS row_count,
      encode(sha256(convert_to(COALESCE(string_agg(
        row.ordinal::text || ':' || row.row_sha256::text || E'\n',
        '' ORDER BY row.ordinal), ''), 'UTF8')), 'hex') AS family_sha256
    FROM (VALUES ('benchmark'::text, 1), ('profile'::text, 2)) expected(family, position)
    LEFT JOIN dna.pro_league_evidence_stage_row row
      ON row.owner_id = v_owner AND row.generation_id = v_generation
      AND row.family = expected.family
    GROUP BY expected.family, expected.position
  ) SELECT encode(sha256(convert_to(string_agg(
      family || ':' || row_count::text || ':' || family_sha256 || E'\n',
      '' ORDER BY position), 'UTF8')), 'hex')::character(64)
    INTO v_digest FROM family;
  SELECT published.disposition INTO v_disposition
  FROM dna.publish_pro_league_evidence_generation(
    v_owner, v_generation, 'synthetic-evidence-worker', 1, 2, 0,
    v_digest, '2026-09-07T01:01:00Z'
  ) published;
  IF v_disposition <> 'published'
     OR (SELECT count(*) FROM dna.read_active_pro_league_evidence_generation(v_owner)) <> 1
     OR (SELECT count(*) FROM dna.list_active_pro_league_evidence_rows(v_owner, 'profile', -1, 5000)) <> 2
     OR EXISTS (SELECT 1 FROM dna.pro_league_evidence_stage_row
       WHERE owner_id = v_owner AND generation_id = v_generation) THEN
    RAISE EXCEPTION 'Pro League evidence generation was not atomically published';
  END IF;

  SELECT dna.begin_pro_league_evidence_generation(
    v_owner, v_partial, '84000000-0000-4000-8000-000000000201',
    'synthetic-partial-worker', v_source_sha, '2026-09-07T02:00:00Z',
    6, 4, 1, 1, 0, 0
  ) INTO v_disposition;
  PERFORM dna.stage_pro_league_evidence_rows(
    v_owner, v_partial, 'synthetic-partial-worker', 'benchmark', 0,
    '[{"naturalKey":"[\"1v1\",1000]","payload":{"raceType":"1v1","distanceMetres":1000}}]'::jsonb
  );
  WITH family AS (
    SELECT expected.family, expected.position, count(row.ordinal)::integer AS row_count,
      encode(sha256(convert_to(COALESCE(string_agg(
        row.ordinal::text || ':' || row.row_sha256::text || E'\n',
        '' ORDER BY row.ordinal), ''), 'UTF8')), 'hex') AS family_sha256
    FROM (VALUES ('benchmark'::text, 1), ('profile'::text, 2)) expected(family, position)
    LEFT JOIN dna.pro_league_evidence_stage_row row
      ON row.owner_id = v_owner AND row.generation_id = v_partial
      AND row.family = expected.family
    GROUP BY expected.family, expected.position
  ) SELECT encode(sha256(convert_to(string_agg(
      family || ':' || row_count::text || ':' || family_sha256 || E'\n',
      '' ORDER BY position), 'UTF8')), 'hex')::character(64)
    INTO v_digest FROM family;
  BEGIN
    PERFORM * FROM dna.publish_pro_league_evidence_generation(
      v_owner, v_partial, 'synthetic-partial-worker', 2, 0, 0,
      v_digest, '2026-09-07T02:01:00Z'
    );
    RAISE EXCEPTION 'partial Pro League evidence generation was published';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'partial Pro League evidence generation was published' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_count
  FROM dna.read_active_pro_league_evidence_generation(v_owner) generation
  WHERE generation.generation_id = v_generation;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'partial generation replaced last-good evidence';
  END IF;
END
$lifecycle$;

SET LOCAL app.owner_id = '84000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_active_pro_league_evidence_generation(
      '84000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner Pro League evidence was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Pro League evidence was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;
