BEGIN;

CREATE TABLE dna.accepted_pro_league_breeding_analysis (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  analysis_id text NOT NULL CHECK (
    length(analysis_id) BETWEEN 1 AND 256
    AND analysis_id = btrim(analysis_id)
    AND analysis_id !~ '[[:cntrl:]]'
  ),
  accepted_at timestamptz NOT NULL,
  roster_evidence_cutoff_at timestamptz NOT NULL,
  latest_performance_import_at timestamptz NOT NULL,
  latest_arena_import_at timestamptz,
  ranking_count integer NOT NULL CHECK (ranking_count BETWEEN 1 AND 200),
  candidate_count integer NOT NULL CHECK (candidate_count BETWEEN 1 AND 2000),
  canonical_byte_count integer NOT NULL CHECK (
    canonical_byte_count BETWEEN 2 AND 4718592
  ),
  content_sha256 character(64) NOT NULL CHECK (
    content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  canonical_payload text NOT NULL CHECK (
    octet_length(canonical_payload) BETWEEN 2 AND 4718592
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, analysis_id),
  UNIQUE (owner_id, content_sha256),
  CHECK (roster_evidence_cutoff_at <= accepted_at),
  CHECK (latest_performance_import_at <= accepted_at),
  CHECK (latest_arena_import_at IS NULL OR latest_arena_import_at <= accepted_at)
);

ALTER TABLE dna.accepted_pro_league_breeding_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.accepted_pro_league_breeding_analysis FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.accepted_pro_league_breeding_analysis
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.record_accepted_pro_league_breeding_analysis(
  p_owner_id uuid,
  p_analysis_id text,
  p_accepted_at timestamptz,
  p_roster_evidence_cutoff_at timestamptz,
  p_latest_performance_import_at timestamptz,
  p_latest_arena_import_at timestamptz,
  p_expected_ranking_count integer,
  p_expected_candidate_count integer,
  p_expected_content_sha256 character(64),
  p_canonical_payload text
)
RETURNS TABLE (
  disposition text,
  analysis_id text,
  ranking_count integer,
  candidate_count integer,
  canonical_byte_count integer,
  content_sha256 character(64)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.accepted_pro_league_breeding_analysis%ROWTYPE;
  v_payload jsonb;
  v_candidate_count integer;
  v_byte_count integer;
  v_content_sha character(64);
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped accepted Pro League breeding analysis record denied';
  END IF;
  IF p_owner_id IS NULL OR p_analysis_id IS NULL
     OR p_analysis_id <> btrim(p_analysis_id)
     OR length(p_analysis_id) NOT BETWEEN 1 AND 256
     OR p_analysis_id ~ '[[:cntrl:]]'
     OR p_accepted_at IS NULL OR p_roster_evidence_cutoff_at IS NULL
     OR p_latest_performance_import_at IS NULL
     OR p_expected_ranking_count IS NULL
     OR p_expected_candidate_count IS NULL
     OR p_expected_content_sha256 IS NULL
     OR p_roster_evidence_cutoff_at > p_accepted_at
     OR p_latest_performance_import_at > p_accepted_at
     OR p_latest_arena_import_at > p_accepted_at
     OR p_expected_ranking_count NOT BETWEEN 1 AND 200
     OR p_expected_candidate_count NOT BETWEEN 1 AND 2000
     OR p_expected_content_sha256 !~ '^[a-f0-9]{64}$'
     OR p_canonical_payload IS NULL
     OR octet_length(p_canonical_payload) NOT BETWEEN 2 AND 4718592 THEN
    RAISE EXCEPTION 'accepted Pro League breeding analysis metadata is invalid';
  END IF;

  BEGIN
    v_payload := p_canonical_payload::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'accepted Pro League breeding analysis payload is invalid JSON';
  END;
  IF jsonb_typeof(v_payload) <> 'object'
     OR v_payload ? 'contentSha256'
     OR v_payload ->> 'analysisId' IS DISTINCT FROM p_analysis_id
     OR v_payload ->> 'acceptanceStatus' IS DISTINCT FROM 'accepted'
     OR v_payload ->> 'completionStatus' IS DISTINCT FROM 'complete'
     OR v_payload ->> 'proLeagueRaceTypeEvidence' IS DISTINCT FROM 'unavailable'
     OR jsonb_typeof(v_payload -> 'rankings') <> 'array'
     OR jsonb_array_length(v_payload -> 'rankings') <> p_expected_ranking_count
     OR jsonb_typeof(v_payload -> 'expectedRankingCount') <> 'number'
     OR (v_payload ->> 'expectedRankingCount')::integer <> p_expected_ranking_count
     OR jsonb_typeof(v_payload -> 'expectedCandidateCount') <> 'number'
     OR (v_payload ->> 'expectedCandidateCount')::integer <> p_expected_candidate_count
     OR v_payload ->> 'acceptedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
     OR (v_payload ->> 'acceptedAt')::timestamptz <> p_accepted_at
     OR v_payload ->> 'rosterEvidenceCutoffAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
     OR (v_payload ->> 'rosterEvidenceCutoffAt')::timestamptz <> p_roster_evidence_cutoff_at
     OR v_payload ->> 'latestAcceptedPerformanceImportAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
     OR (v_payload ->> 'latestAcceptedPerformanceImportAt')::timestamptz <> p_latest_performance_import_at
     OR (
       p_latest_arena_import_at IS NULL
       AND jsonb_typeof(v_payload -> 'latestAcceptedArenaImportAt') IS DISTINCT FROM 'null'
     )
     OR (
       p_latest_arena_import_at IS NOT NULL
       AND (
         v_payload ->> 'latestAcceptedArenaImportAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
         OR (v_payload ->> 'latestAcceptedArenaImportAt')::timestamptz <> p_latest_arena_import_at
       )
     ) THEN
    RAISE EXCEPTION 'accepted Pro League breeding analysis payload authority is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_payload -> 'rankings') ranking
    WHERE jsonb_typeof(ranking) <> 'object'
      OR jsonb_typeof(ranking -> 'rankingId') <> 'string'
      OR jsonb_typeof(ranking -> 'rankingLabel') <> 'string'
      OR jsonb_typeof(ranking -> 'candidates') <> 'array'
      OR ranking ->> 'lastImported' IS NULL
      OR (ranking ->> 'lastImported')::timestamptz <> p_latest_performance_import_at
      OR (
        p_latest_arena_import_at IS NULL
        AND jsonb_typeof(ranking -> 'arenaLastImported') IS DISTINCT FROM 'null'
      )
      OR (
        p_latest_arena_import_at IS NOT NULL
        AND (
          ranking ->> 'arenaLastImported' IS NULL
          OR (ranking ->> 'arenaLastImported')::timestamptz <> p_latest_arena_import_at
        )
      )
      OR ranking ->> 'evaluatedAt' IS NULL
      OR (ranking ->> 'evaluatedAt')::timestamptz > p_accepted_at
      OR (
        jsonb_typeof(ranking -> 'dataCurrentThrough') IS DISTINCT FROM 'null'
        AND (
          ranking ->> 'dataCurrentThrough' IS NULL
          OR (ranking ->> 'dataCurrentThrough')::timestamptz > p_roster_evidence_cutoff_at
        )
      )
  ) THEN
    RAISE EXCEPTION 'accepted Pro League breeding ranking authority is invalid';
  END IF;

  IF (
    SELECT count(DISTINCT ranking ->> 'rankingId')
    FROM jsonb_array_elements(v_payload -> 'rankings') ranking
  ) <> p_expected_ranking_count OR (
    SELECT count(DISTINCT ranking ->> 'rankingLabel')
    FROM jsonb_array_elements(v_payload -> 'rankings') ranking
  ) <> p_expected_ranking_count THEN
    RAISE EXCEPTION 'accepted Pro League breeding ranking identity is duplicated';
  END IF;

  SELECT COALESCE(sum(jsonb_array_length(ranking -> 'candidates')), 0)::integer
  INTO v_candidate_count
  FROM jsonb_array_elements(v_payload -> 'rankings') ranking;
  v_byte_count := octet_length(p_canonical_payload);
  v_content_sha := encode(
    sha256(convert_to(p_canonical_payload, 'UTF8')), 'hex'
  )::character(64);
  IF v_candidate_count <> p_expected_candidate_count
     OR v_content_sha <> p_expected_content_sha256 THEN
    RAISE EXCEPTION 'accepted Pro League breeding analysis count or digest mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':accepted-pro-league-breeding-analysis:' || p_analysis_id,
    0
  ));
  SELECT analysis.* INTO v_existing
  FROM dna.accepted_pro_league_breeding_analysis analysis
  WHERE analysis.owner_id = p_owner_id
    AND analysis.analysis_id = p_analysis_id;
  IF FOUND THEN
    IF v_existing.accepted_at <> p_accepted_at
       OR v_existing.roster_evidence_cutoff_at <> p_roster_evidence_cutoff_at
       OR v_existing.latest_performance_import_at <> p_latest_performance_import_at
       OR v_existing.latest_arena_import_at IS DISTINCT FROM p_latest_arena_import_at
       OR v_existing.ranking_count <> p_expected_ranking_count
       OR v_existing.candidate_count <> p_expected_candidate_count
       OR v_existing.canonical_byte_count <> v_byte_count
       OR v_existing.content_sha256 <> p_expected_content_sha256
       OR v_existing.canonical_payload <> p_canonical_payload THEN
      RAISE EXCEPTION 'accepted Pro League breeding analysis replay conflicts';
    END IF;
    RETURN QUERY SELECT 'existing'::text, v_existing.analysis_id,
      v_existing.ranking_count, v_existing.candidate_count,
      v_existing.canonical_byte_count, v_existing.content_sha256;
    RETURN;
  END IF;

  INSERT INTO dna.accepted_pro_league_breeding_analysis (
    owner_id, analysis_id, accepted_at, roster_evidence_cutoff_at,
    latest_performance_import_at, latest_arena_import_at, ranking_count,
    candidate_count, canonical_byte_count, content_sha256, canonical_payload
  ) VALUES (
    p_owner_id, p_analysis_id, p_accepted_at, p_roster_evidence_cutoff_at,
    p_latest_performance_import_at, p_latest_arena_import_at,
    p_expected_ranking_count, p_expected_candidate_count, v_byte_count,
    p_expected_content_sha256, p_canonical_payload
  );
  RETURN QUERY SELECT 'recorded'::text, p_analysis_id,
    p_expected_ranking_count, p_expected_candidate_count, v_byte_count,
    p_expected_content_sha256;
END
$function$;

CREATE FUNCTION dna.read_accepted_pro_league_breeding_analysis(
  p_owner_id uuid,
  p_analysis_id text
)
RETURNS TABLE (
  analysis_id text,
  accepted_at timestamptz,
  roster_evidence_cutoff_at timestamptz,
  latest_performance_import_at timestamptz,
  latest_arena_import_at timestamptz,
  ranking_count integer,
  candidate_count integer,
  canonical_byte_count integer,
  content_sha256 character(64),
  canonical_payload text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped accepted Pro League breeding analysis read denied';
  END IF;
  IF p_analysis_id IS NULL OR p_analysis_id <> btrim(p_analysis_id)
     OR length(p_analysis_id) NOT BETWEEN 1 AND 256
     OR p_analysis_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'accepted Pro League breeding analysis identity is invalid';
  END IF;
  RETURN QUERY
  SELECT analysis.analysis_id, analysis.accepted_at,
    analysis.roster_evidence_cutoff_at,
    analysis.latest_performance_import_at, analysis.latest_arena_import_at,
    analysis.ranking_count, analysis.candidate_count,
    analysis.canonical_byte_count, analysis.content_sha256,
    analysis.canonical_payload
  FROM dna.accepted_pro_league_breeding_analysis analysis
  WHERE analysis.owner_id = p_owner_id
    AND analysis.analysis_id = p_analysis_id;
END
$function$;

REVOKE ALL ON dna.accepted_pro_league_breeding_analysis FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.record_accepted_pro_league_breeding_analysis(
  uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,integer,integer,character,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_accepted_pro_league_breeding_analysis(uuid,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.record_accepted_pro_league_breeding_analysis(
  uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,integer,integer,character,text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_accepted_pro_league_breeding_analysis(uuid,text)
  TO dna_app_runtime;

COMMIT;
