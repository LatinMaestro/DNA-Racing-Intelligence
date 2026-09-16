BEGIN;

CREATE FUNCTION dna.read_active_dna_core_race_history_generation(
  p_owner_id uuid
)
RETURNS SETOF dna.dna_core_race_history_generation
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped active Core history generation read denied';
  END IF;
  RETURN QUERY
  SELECT generation.*
  FROM dna.dna_core_race_history_generation_active active
  JOIN dna.dna_core_race_history_generation generation
    ON generation.owner_id = active.owner_id
   AND generation.generation_id = active.generation_id
  WHERE active.owner_id = p_owner_id
    AND generation.state = 'published';
END
$function$;

CREATE FUNCTION dna.read_active_dna_core_race_history_generation_rows(
  p_owner_id uuid,
  p_after_ordinal integer,
  p_limit integer
)
RETURNS TABLE (
  generation_id character(64),
  ordinal integer,
  natural_key text,
  row_sha256 character(64),
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped active Core history row read denied';
  END IF;
  IF p_after_ordinal IS NULL OR p_after_ordinal < -1 OR p_after_ordinal > 499999
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 250 THEN
    RAISE EXCEPTION 'active Core history row read bound is invalid';
  END IF;
  RETURN QUERY
  SELECT row.generation_id, row.ordinal, row.natural_key,
    row.row_sha256, row.payload
  FROM dna.dna_core_race_history_generation_active active
  JOIN dna.dna_core_race_history_generation generation
    ON generation.owner_id = active.owner_id
   AND generation.generation_id = active.generation_id
  JOIN dna.dna_core_race_history_generation_row row
    ON row.owner_id = active.owner_id
   AND row.generation_id = active.generation_id
  WHERE active.owner_id = p_owner_id
    AND generation.state = 'published'
    AND row.ordinal > p_after_ordinal
  ORDER BY row.ordinal
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON FUNCTION dna.read_active_dna_core_race_history_generation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_active_dna_core_race_history_generation_rows(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_active_dna_core_race_history_generation(uuid) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_active_dna_core_race_history_generation_rows(uuid,integer,integer) TO dna_app_runtime;

COMMIT;
