BEGIN;

CREATE FUNCTION dna.assert_current_pro_league_breeding_publication_authority(
  p_owner_id uuid,
  p_roster_evidence_cutoff_at timestamptz,
  p_latest_performance_import_at timestamptz,
  p_latest_arena_import_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_authority record;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League breeding publication write guard denied';
  END IF;
  IF p_roster_evidence_cutoff_at IS NULL
     OR p_latest_performance_import_at IS NULL THEN
    RAISE EXCEPTION 'Pro League breeding publication write authority is invalid';
  END IF;

  INSERT INTO dna.dataset_stream (owner_id, source_type)
  VALUES (p_owner_id, 'current_arena'), (p_owner_id, 'race_merge')
  ON CONFLICT (owner_id, source_type) DO NOTHING;

  PERFORM 1
  FROM dna.dataset_stream stream
  WHERE stream.owner_id = p_owner_id
    AND stream.source_type IN ('current_arena', 'race_merge')
  ORDER BY stream.source_type
  FOR UPDATE;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':pro-league-evidence-active', 0
  ));

  SELECT authority.* INTO v_authority
  FROM dna.read_current_pro_league_breeding_publication_authority(
    p_owner_id
  ) authority;
  IF NOT FOUND
     OR v_authority.roster_evidence_cutoff_at
          IS DISTINCT FROM p_roster_evidence_cutoff_at
     OR v_authority.latest_performance_import_at
          IS DISTINCT FROM p_latest_performance_import_at
     OR v_authority.latest_arena_import_at
          IS DISTINCT FROM p_latest_arena_import_at THEN
    RAISE EXCEPTION 'current Pro League breeding publication authority changed';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION dna.assert_current_pro_league_breeding_publication_authority(
  uuid,timestamptz,timestamptz,timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.assert_current_pro_league_breeding_publication_authority(
  uuid,timestamptz,timestamptz,timestamptz
) TO dna_app_runtime;

COMMIT;
