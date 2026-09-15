BEGIN;

CREATE FUNCTION dna.read_dna_open_lab_combined_serving_owned_cores(
  p_owner_id uuid
)
RETURNS TABLE (
  owner_id uuid,
  generation_id uuid,
  source_core_id bigint,
  display_name text,
  core_class text,
  element text,
  f_number integer,
  sex text,
  color_source_value text,
  observed_at timestamptz,
  raw_evidence_sha256 character(64)
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped combined owned Core read denied';
  END IF;
  RETURN QUERY
  SELECT snapshot.owner_id, snapshot.generation_id, snapshot.source_core_id,
    snapshot.display_name, snapshot.core_class, snapshot.element,
    snapshot.f_number, snapshot.sex, snapshot.color_source_value,
    snapshot.observed_at, snapshot.raw_evidence_sha256
  FROM dna.dna_open_lab_daily_refresh_active active
  JOIN dna.dna_open_lab_daily_refresh_generation combined
    ON combined.owner_id = active.owner_id
   AND combined.refresh_cycle_id = active.refresh_cycle_id
  JOIN dna.dna_open_lab_owned_core_snapshot snapshot
    ON snapshot.owner_id = combined.owner_id
   AND snapshot.generation_id = combined.current_state_generation_id
  WHERE active.owner_id = p_owner_id
  ORDER BY snapshot.source_core_id;
END
$function$;

REVOKE ALL ON FUNCTION
  dna.read_dna_open_lab_combined_serving_owned_cores(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.read_dna_open_lab_combined_serving_owned_cores(uuid)
TO dna_app_runtime;

COMMIT;
