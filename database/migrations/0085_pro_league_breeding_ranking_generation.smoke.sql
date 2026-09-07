BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('85000000-0000-4000-8000-000000000001', 'synthetic_breeding_owner'),
  ('85000000-0000-4000-8000-000000000002', 'synthetic_breeding_other');

DO $privileges$
BEGIN
  IF has_table_privilege('dna_app_runtime', 'dna.pro_league_breeding_ranking_generation', 'SELECT')
     OR has_table_privilege('dna_app_runtime', 'dna.pro_league_breeding_ranking_row', 'SELECT')
     OR has_table_privilege('dna_app_runtime', 'dna.pro_league_breeding_ranking_active', 'SELECT')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.publish_pro_league_breeding_ranking_generation(uuid,uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,character,jsonb,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('dna_app_runtime', 'dna.read_active_pro_league_breeding_ranking_generation(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Pro League breeding ranking runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '85000000-0000-4000-8000-000000000001';
DO $lifecycle$
DECLARE
  v_owner constant uuid := '85000000-0000-4000-8000-000000000001';
  v_generation constant uuid := '85000000-0000-4000-8000-000000000101';
  v_invalid constant uuid := '85000000-0000-4000-8000-000000000102';
  v_regression constant uuid := '85000000-0000-4000-8000-000000000103';
  v_import_regression constant uuid := '85000000-0000-4000-8000-000000000104';
  v_canonical text := '{"candidates":[{"pairId":"private-pair"}],"rankingId":"ranking-1"}';
  v_row_sha character(64);
  v_payload_sha character(64);
  v_rows jsonb;
  v_disposition text;
  v_count integer;
BEGIN
  v_row_sha := encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex')::character(64);
  v_payload_sha := encode(sha256(convert_to('0:' || v_row_sha::text || E'\n', 'UTF8')), 'hex')::character(64);
  v_rows := jsonb_build_array(jsonb_build_object(
    'rankingId', 'ranking-1',
    'canonicalPayload', v_canonical,
    'rowSha256', v_row_sha
  ));

  SELECT published.disposition INTO v_disposition
  FROM dna.publish_pro_league_breeding_ranking_generation(
    v_owner, v_generation, 'synthetic-breeding-worker',
    '2026-09-07T01:00:00Z', '2026-09-07T00:30:00Z', NULL,
    1, 1, v_payload_sha, v_rows, '2026-09-07T02:00:00Z'
  ) published;
  IF v_disposition <> 'published' THEN
    RAISE EXCEPTION 'Pro League breeding ranking generation did not publish';
  END IF;
  SELECT count(*) INTO v_count
  FROM dna.read_active_pro_league_breeding_ranking_generation(v_owner) active
  WHERE active.generation_id = v_generation
    AND active.ranking_count = 1
    AND active.candidate_count = 1
    AND jsonb_array_length(active.rows) = 1
    AND active.rows -> 0 ->> 'canonicalPayload' = v_canonical;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'active compact breeding ranking generation is invalid';
  END IF;

  SELECT published.disposition INTO v_disposition
  FROM dna.publish_pro_league_breeding_ranking_generation(
    v_owner, v_generation, 'synthetic-breeding-worker',
    '2026-09-07T01:00:00Z', '2026-09-07T00:30:00Z', NULL,
    1, 1, v_payload_sha, v_rows, '2026-09-07T02:00:00Z'
  ) published;
  IF v_disposition <> 'existing' THEN
    RAISE EXCEPTION 'exact Pro League breeding ranking replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM dna.publish_pro_league_breeding_ranking_generation(
      v_owner, v_invalid, 'synthetic-breeding-worker',
      '2026-09-07T02:00:00Z', '2026-09-07T00:30:00Z', NULL,
      1, 1, repeat('f', 64)::character(64), v_rows,
      '2026-09-07T03:00:00Z'
    );
    RAISE EXCEPTION 'invalid digest replaced last-good breeding rankings';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid digest replaced last-good breeding rankings' THEN RAISE; END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM dna.pro_league_breeding_ranking_generation
    WHERE owner_id = v_owner AND generation_id = v_invalid
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.pro_league_breeding_ranking_active
    WHERE owner_id = v_owner AND generation_id = v_generation
  ) THEN
    RAISE EXCEPTION 'failed breeding publication disturbed last-good state';
  END IF;

  BEGIN
    PERFORM * FROM dna.publish_pro_league_breeding_ranking_generation(
      v_owner, v_regression, 'synthetic-breeding-worker',
      '2026-09-06T23:00:00Z', '2026-09-07T00:30:00Z', NULL,
      1, 1, v_payload_sha, v_rows, '2026-09-07T04:00:00Z'
    );
    RAISE EXCEPTION 'older breeding evidence cutoff replaced last-good state';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'older breeding evidence cutoff replaced last-good state' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.publish_pro_league_breeding_ranking_generation(
      v_owner, v_import_regression, 'synthetic-breeding-worker',
      '2026-09-07T01:00:00Z', NULL, NULL,
      1, 1, v_payload_sha, v_rows, '2026-09-07T05:00:00Z'
    );
    RAISE EXCEPTION 'older breeding import authority replaced last-good state';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'older breeding import authority replaced last-good state' THEN RAISE; END IF;
  END;
END
$lifecycle$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '85000000-0000-4000-8000-000000000001';
DO $runtime_read$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.read_active_pro_league_breeding_ranking_generation(
      '85000000-0000-4000-8000-000000000001'
    ) active
    WHERE active.generation_id = '85000000-0000-4000-8000-000000000101'
  ) <> 1 THEN
    RAISE EXCEPTION 'runtime could not read its active breeding generation';
  END IF;
END
$runtime_read$;
RESET ROLE;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '85000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_active_pro_league_breeding_ranking_generation(
      '85000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner breeding ranking generation was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner breeding ranking generation was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;
RESET ROLE;

ROLLBACK;
