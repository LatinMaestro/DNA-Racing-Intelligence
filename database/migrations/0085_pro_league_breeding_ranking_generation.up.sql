BEGIN;

CREATE TABLE dna.pro_league_breeding_ranking_generation (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  worker_id text NOT NULL CHECK (
    worker_id = btrim(worker_id)
    AND worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  roster_evidence_cutoff_at timestamptz NOT NULL,
  latest_performance_import_at timestamptz,
  latest_arena_import_at timestamptz,
  ranking_count integer NOT NULL CHECK (ranking_count BETWEEN 0 AND 200),
  candidate_count integer NOT NULL CHECK (candidate_count BETWEEN 0 AND 2000),
  canonical_byte_count integer NOT NULL CHECK (
    canonical_byte_count BETWEEN 0 AND 4194304
  ),
  payload_sha256 character(64) NOT NULL CHECK (
    payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, generation_id),
  CHECK (
    roster_evidence_cutoff_at <= published_at
  ),
  CHECK (
    latest_performance_import_at IS NULL
    OR latest_performance_import_at <= published_at
  ),
  CHECK (
    latest_arena_import_at IS NULL
    OR latest_arena_import_at <= published_at
  )
);

CREATE TABLE dna.pro_league_breeding_ranking_row (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 199),
  ranking_id text NOT NULL CHECK (
    length(ranking_id) BETWEEN 1 AND 256
    AND ranking_id = btrim(ranking_id)
    AND ranking_id !~ '[[:cntrl:]]'
  ),
  row_sha256 character(64) NOT NULL CHECK (row_sha256 ~ '^[a-f0-9]{64}$'),
  canonical_payload text NOT NULL CHECK (
    octet_length(canonical_payload) BETWEEN 2 AND 524288
  ),
  PRIMARY KEY (owner_id, generation_id, ordinal),
  UNIQUE (owner_id, generation_id, ranking_id),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.pro_league_breeding_ranking_generation(owner_id, generation_id)
    ON DELETE RESTRICT
);

CREATE TABLE dna.pro_league_breeding_ranking_active (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.pro_league_breeding_ranking_generation(owner_id, generation_id)
    ON DELETE RESTRICT
);

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'pro_league_breeding_ranking_generation',
    'pro_league_breeding_ranking_row',
    'pro_league_breeding_ranking_active'
  ] LOOP
    EXECUTE format('ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY owner_isolation ON dna.%I USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id())',
      v_table
    );
  END LOOP;
END
$rls$;

CREATE FUNCTION dna.publish_pro_league_breeding_ranking_generation(
  p_owner_id uuid,
  p_generation_id uuid,
  p_worker_id text,
  p_roster_evidence_cutoff_at timestamptz,
  p_latest_performance_import_at timestamptz,
  p_latest_arena_import_at timestamptz,
  p_expected_ranking_count integer,
  p_expected_candidate_count integer,
  p_expected_payload_sha256 character(64),
  p_rows jsonb,
  p_published_at timestamptz
)
RETURNS TABLE (
  disposition text,
  generation_id uuid,
  ranking_count integer,
  candidate_count integer,
  canonical_byte_count integer,
  payload_sha256 character(64)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_active dna.pro_league_breeding_ranking_generation%ROWTYPE;
  v_existing dna.pro_league_breeding_ranking_generation%ROWTYPE;
  v_entry jsonb;
  v_index integer;
  v_ranking_id text;
  v_canonical text;
  v_payload jsonb;
  v_row_sha character(64);
  v_candidate_count integer := 0;
  v_byte_count integer := 0;
  v_hash_lines text := '';
  v_payload_sha character(64);
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League breeding ranking publication denied';
  END IF;
  IF p_generation_id IS NULL OR p_worker_id IS NULL
     OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_roster_evidence_cutoff_at IS NULL OR p_published_at IS NULL
     OR p_roster_evidence_cutoff_at > p_published_at
     OR p_latest_performance_import_at > p_published_at
     OR p_latest_arena_import_at > p_published_at
     OR p_expected_ranking_count NOT BETWEEN 0 AND 200
     OR p_expected_candidate_count NOT BETWEEN 0 AND 2000
     OR p_expected_payload_sha256 !~ '^[a-f0-9]{64}$'
     OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) <> p_expected_ranking_count THEN
    RAISE EXCEPTION 'Pro League breeding ranking generation metadata is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':pro-league-breeding-ranking', 0
  ));

  SELECT generation.* INTO v_active
  FROM dna.pro_league_breeding_ranking_active active
  JOIN dna.pro_league_breeding_ranking_generation generation
    ON generation.owner_id = active.owner_id
   AND generation.generation_id = active.generation_id
  WHERE active.owner_id = p_owner_id;

  FOR v_entry, v_index IN
    SELECT value, ordinality::integer - 1
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_entry) <> 'object'
       OR jsonb_typeof(v_entry -> 'rankingId') <> 'string'
       OR jsonb_typeof(v_entry -> 'canonicalPayload') <> 'string'
       OR jsonb_typeof(v_entry -> 'rowSha256') <> 'string' THEN
      RAISE EXCEPTION 'Pro League breeding ranking row envelope is invalid';
    END IF;
    v_ranking_id := v_entry ->> 'rankingId';
    v_canonical := v_entry ->> 'canonicalPayload';
    v_row_sha := (v_entry ->> 'rowSha256')::character(64);
    IF v_ranking_id <> btrim(v_ranking_id)
       OR length(v_ranking_id) NOT BETWEEN 1 AND 256
       OR v_ranking_id ~ '[[:cntrl:]]'
       OR octet_length(v_canonical) NOT BETWEEN 2 AND 524288
       OR v_row_sha !~ '^[a-f0-9]{64}$'
       OR encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex') <> v_row_sha THEN
      RAISE EXCEPTION 'Pro League breeding ranking row integrity is invalid';
    END IF;
    BEGIN
      v_payload := v_canonical::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Pro League breeding ranking canonical payload is invalid JSON';
    END;
    IF jsonb_typeof(v_payload) <> 'object'
       OR v_payload ->> 'rankingId' IS DISTINCT FROM v_ranking_id
       OR jsonb_typeof(v_payload -> 'candidates') <> 'array' THEN
      RAISE EXCEPTION 'Pro League breeding ranking payload shape is invalid';
    END IF;
    v_candidate_count := v_candidate_count
      + jsonb_array_length(v_payload -> 'candidates');
    v_byte_count := v_byte_count + octet_length(v_canonical);
    IF v_candidate_count > 2000 OR v_byte_count > 4194304 THEN
      RAISE EXCEPTION 'Pro League breeding ranking compact generation bound was exceeded';
    END IF;
    v_hash_lines := v_hash_lines || v_index::text || ':' || v_row_sha::text || E'\n';
  END LOOP;
  v_payload_sha := encode(
    sha256(convert_to(v_hash_lines, 'UTF8')), 'hex'
  )::character(64);
  IF v_candidate_count <> p_expected_candidate_count
     OR v_payload_sha <> p_expected_payload_sha256 THEN
    RAISE EXCEPTION 'Pro League breeding ranking generation count or digest mismatch';
  END IF;

  SELECT generation.* INTO v_existing
  FROM dna.pro_league_breeding_ranking_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id;
  IF FOUND THEN
    IF v_existing.worker_id <> p_worker_id
       OR v_existing.roster_evidence_cutoff_at <> p_roster_evidence_cutoff_at
       OR v_existing.latest_performance_import_at IS DISTINCT FROM p_latest_performance_import_at
       OR v_existing.latest_arena_import_at IS DISTINCT FROM p_latest_arena_import_at
       OR v_existing.ranking_count <> p_expected_ranking_count
       OR v_existing.candidate_count <> p_expected_candidate_count
       OR v_existing.canonical_byte_count <> v_byte_count
       OR v_existing.payload_sha256 <> p_expected_payload_sha256
       OR v_existing.published_at <> p_published_at THEN
      RAISE EXCEPTION 'Pro League breeding ranking generation replay conflicts';
    END IF;
    RETURN QUERY SELECT 'existing'::text, v_existing.generation_id,
      v_existing.ranking_count, v_existing.candidate_count,
      v_existing.canonical_byte_count, v_existing.payload_sha256;
    RETURN;
  END IF;

  IF v_active.generation_id IS NOT NULL AND (
    p_roster_evidence_cutoff_at < v_active.roster_evidence_cutoff_at
    OR p_published_at < v_active.published_at
    OR (
      v_active.latest_performance_import_at IS NOT NULL
      AND (
        p_latest_performance_import_at IS NULL
        OR p_latest_performance_import_at < v_active.latest_performance_import_at
      )
    )
    OR (
      v_active.latest_arena_import_at IS NOT NULL
      AND (
        p_latest_arena_import_at IS NULL
        OR p_latest_arena_import_at < v_active.latest_arena_import_at
      )
    )
  ) THEN
    RAISE EXCEPTION 'Pro League breeding ranking generation would regress active authority';
  END IF;

  INSERT INTO dna.pro_league_breeding_ranking_generation (
    owner_id, generation_id, worker_id, roster_evidence_cutoff_at,
    latest_performance_import_at, latest_arena_import_at, ranking_count,
    candidate_count, canonical_byte_count, payload_sha256, published_at
  ) VALUES (
    p_owner_id, p_generation_id, p_worker_id, p_roster_evidence_cutoff_at,
    p_latest_performance_import_at, p_latest_arena_import_at,
    p_expected_ranking_count, p_expected_candidate_count, v_byte_count,
    p_expected_payload_sha256, p_published_at
  );
  INSERT INTO dna.pro_league_breeding_ranking_row (
    owner_id, generation_id, ordinal, ranking_id, row_sha256, canonical_payload
  )
  SELECT p_owner_id, p_generation_id, ordinality::integer - 1,
    value ->> 'rankingId', (value ->> 'rowSha256')::character(64),
    value ->> 'canonicalPayload'
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY;
  INSERT INTO dna.pro_league_breeding_ranking_active (
    owner_id, generation_id, activated_at
  ) VALUES (p_owner_id, p_generation_id, p_published_at)
  ON CONFLICT (owner_id) DO UPDATE SET
    generation_id = EXCLUDED.generation_id,
    activated_at = EXCLUDED.activated_at;

  RETURN QUERY SELECT 'published'::text, p_generation_id,
    p_expected_ranking_count, p_expected_candidate_count,
    v_byte_count, p_expected_payload_sha256;
END
$function$;

CREATE FUNCTION dna.read_active_pro_league_breeding_ranking_generation(
  p_owner_id uuid
)
RETURNS TABLE (
  generation_id uuid,
  worker_id text,
  roster_evidence_cutoff_at timestamptz,
  latest_performance_import_at timestamptz,
  latest_arena_import_at timestamptz,
  ranking_count integer,
  candidate_count integer,
  canonical_byte_count integer,
  payload_sha256 character(64),
  published_at timestamptz,
  rows jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League breeding ranking read denied';
  END IF;
  RETURN QUERY
  SELECT generation.generation_id, generation.worker_id,
    generation.roster_evidence_cutoff_at,
    generation.latest_performance_import_at,
    generation.latest_arena_import_at, generation.ranking_count,
    generation.candidate_count, generation.canonical_byte_count,
    generation.payload_sha256, generation.published_at,
    COALESCE(jsonb_agg(jsonb_build_object(
      'ordinal', ranking.ordinal,
      'rankingId', ranking.ranking_id,
      'rowSha256', ranking.row_sha256,
      'canonicalPayload', ranking.canonical_payload
    ) ORDER BY ranking.ordinal) FILTER (WHERE ranking.ordinal IS NOT NULL), '[]'::jsonb)
  FROM dna.pro_league_breeding_ranking_active active
  JOIN dna.pro_league_breeding_ranking_generation generation
    ON generation.owner_id = active.owner_id
   AND generation.generation_id = active.generation_id
  LEFT JOIN dna.pro_league_breeding_ranking_row ranking
    ON ranking.owner_id = generation.owner_id
   AND ranking.generation_id = generation.generation_id
  WHERE active.owner_id = p_owner_id
  GROUP BY generation.owner_id, generation.generation_id;
END
$function$;

REVOKE ALL ON dna.pro_league_breeding_ranking_generation FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON dna.pro_league_breeding_ranking_row FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON dna.pro_league_breeding_ranking_active FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.publish_pro_league_breeding_ranking_generation(
  uuid,uuid,text,timestamptz,timestamptz,timestamptz,integer,integer,character,jsonb,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_active_pro_league_breeding_ranking_generation(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.publish_pro_league_breeding_ranking_generation(
  uuid,uuid,text,timestamptz,timestamptz,timestamptz,integer,integer,character,jsonb,timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_active_pro_league_breeding_ranking_generation(uuid)
  TO dna_app_runtime;

COMMIT;
