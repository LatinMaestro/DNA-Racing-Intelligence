BEGIN;

CREATE FUNCTION dna.pro_league_aggregate_refresh_target_source(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_source_version_set_sha256 character(64)
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_source_type text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped aggregate refresh target source denied';
  END IF;
  IF p_source_version_set_sha256 IS NULL
     OR p_source_version_set_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'aggregate refresh target source checksum is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.refresh_id = p_refresh_id
      AND processing.dataset_version_id = p_dataset_version_id
      AND processing.state = 'processing'
      AND processing.source_version_set_sha256 = p_source_version_set_sha256
  ) THEN
    RAISE EXCEPTION 'aggregate refresh target source claim is unavailable';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'aggregate refresh target source versions were superseded';
  END IF;

  SELECT version.source_type::text INTO v_source_type
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active aggregate refresh target source is unavailable';
  END IF;
  IF v_source_type NOT IN ('race_merge', 'core_details', 'current_arena') THEN
    RAISE EXCEPTION 'aggregate refresh target source is unsupported';
  END IF;

  RETURN v_source_type;
END
$function$;

REVOKE ALL ON FUNCTION dna.pro_league_aggregate_refresh_target_source(
  uuid, uuid, uuid, character
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.pro_league_aggregate_refresh_target_source(
  uuid, uuid, uuid, character
) TO dna_app_runtime;

COMMIT;
