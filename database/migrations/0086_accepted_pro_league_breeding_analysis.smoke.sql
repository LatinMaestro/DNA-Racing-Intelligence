BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('86000000-0000-4000-8000-000000000001', 'synthetic_accepted_breeding_owner'),
  ('86000000-0000-4000-8000-000000000002', 'synthetic_accepted_breeding_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
       'dna_app_runtime',
       'dna.accepted_pro_league_breeding_analysis',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.record_accepted_pro_league_breeding_analysis(uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,character,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_accepted_pro_league_breeding_analysis(uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'accepted Pro League breeding runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '86000000-0000-4000-8000-000000000001';
DO $lifecycle$
DECLARE
  v_owner constant uuid := '86000000-0000-4000-8000-000000000001';
  v_analysis constant text := 'accepted-analysis-v1';
  v_payload text := '{"acceptanceStatus":"accepted","acceptedAt":"2026-09-08T02:00:00.000Z","analysisId":"accepted-analysis-v1","completionStatus":"complete","expectedCandidateCount":1,"expectedRankingCount":1,"latestAcceptedArenaImportAt":null,"latestAcceptedPerformanceImportAt":"2026-09-08T00:30:00.000Z","proLeagueRaceTypeEvidence":"unavailable","rankings":[{"arenaLastImported":null,"candidates":[{"pairId":"private-pair"}],"dataCurrentThrough":"2026-09-08T00:15:00.000Z","evaluatedAt":"2026-09-08T01:30:00.000Z","lastImported":"2026-09-08T00:30:00.000Z","rankingId":"ranking-1","rankingLabel":"Bike 1,000 m accepted research"}],"rosterEvidenceCutoffAt":"2026-09-08T01:00:00.000Z"}';
  v_sha character(64);
  v_disposition text;
  v_count integer;
BEGIN
  v_sha := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex')::character(64);
  SELECT recorded.disposition INTO v_disposition
  FROM dna.record_accepted_pro_league_breeding_analysis(
    v_owner, v_analysis, '2026-09-08T02:00:00Z',
    '2026-09-08T01:00:00Z', '2026-09-08T00:30:00Z', NULL,
    1, 1, v_sha, v_payload
  ) recorded;
  IF v_disposition <> 'recorded' THEN
    RAISE EXCEPTION 'accepted Pro League breeding analysis was not recorded';
  END IF;

  SELECT count(*) INTO v_count
  FROM dna.read_accepted_pro_league_breeding_analysis(v_owner, v_analysis) analysis
  WHERE analysis.analysis_id = v_analysis
    AND analysis.ranking_count = 1
    AND analysis.candidate_count = 1
    AND analysis.canonical_byte_count = octet_length(v_payload)
    AND analysis.content_sha256 = v_sha
    AND analysis.canonical_payload = v_payload;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'accepted Pro League breeding analysis read is invalid';
  END IF;

  SELECT recorded.disposition INTO v_disposition
  FROM dna.record_accepted_pro_league_breeding_analysis(
    v_owner, v_analysis, '2026-09-08T02:00:00Z',
    '2026-09-08T01:00:00Z', '2026-09-08T00:30:00Z', NULL,
    1, 1, v_sha, v_payload
  ) recorded;
  IF v_disposition <> 'existing' THEN
    RAISE EXCEPTION 'exact accepted analysis replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM dna.record_accepted_pro_league_breeding_analysis(
      v_owner, v_analysis, '2026-09-08T02:01:00Z',
      '2026-09-08T01:00:00Z', '2026-09-08T00:30:00Z', NULL,
      1, 1, v_sha, v_payload
    );
    RAISE EXCEPTION 'conflicting accepted analysis replay was mutable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting accepted analysis replay was mutable' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.record_accepted_pro_league_breeding_analysis(
      v_owner, 'invalid-digest', '2026-09-08T02:00:00Z',
      '2026-09-08T01:00:00Z', '2026-09-08T00:30:00Z', NULL,
      1, 1, repeat('f', 64)::character(64),
      replace(v_payload, v_analysis, 'invalid-digest')
    );
    RAISE EXCEPTION 'invalid accepted analysis digest was recorded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid accepted analysis digest was recorded' THEN RAISE; END IF;
  END;

  IF (
    SELECT count(*)
    FROM dna.accepted_pro_league_breeding_analysis
    WHERE owner_id = v_owner
  ) <> 1 THEN
    RAISE EXCEPTION 'failed accepted analysis record left residue';
  END IF;
END
$lifecycle$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '86000000-0000-4000-8000-000000000001';
DO $runtime_read$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.read_accepted_pro_league_breeding_analysis(
      '86000000-0000-4000-8000-000000000001',
      'accepted-analysis-v1'
    )
  ) <> 1 THEN
    RAISE EXCEPTION 'runtime could not read its accepted breeding analysis';
  END IF;
END
$runtime_read$;
RESET ROLE;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '86000000-0000-4000-8000-000000000002';
DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_accepted_pro_league_breeding_analysis(
      '86000000-0000-4000-8000-000000000001',
      'accepted-analysis-v1'
    );
    RAISE EXCEPTION 'cross-owner accepted breeding analysis was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner accepted breeding analysis was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;
RESET ROLE;

ROLLBACK;
