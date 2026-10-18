BEGIN;

-- Reuse compact immutable results; do not create a second Race archive.
CREATE INDEX dna_core_history_selected_core_read_idx
  ON dna.dna_core_race_history_generation_row
    (owner_id, generation_id, (payload ->> 'sourceCoreId'), ordinal);

CREATE FUNCTION dna.read_selected_dna_core_race_history_rows(
  p_owner_id uuid,
  p_generation_id character(64),
  p_observation_set_sha256 character(64),
  p_core_ids text[],
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
  IF dna.current_owner_id() IS NULL OR p_owner_id IS NULL
     OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped selected Core history read denied';
  END IF;
  IF p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_observation_set_sha256 IS NULL
     OR p_observation_set_sha256 !~ '^[a-f0-9]{64}$'
     OR p_core_ids IS NULL OR array_ndims(p_core_ids) IS DISTINCT FROM 1
     OR cardinality(p_core_ids) NOT BETWEEN 1 AND 64
     OR EXISTS (
       SELECT 1 FROM unnest(p_core_ids) core_id
       WHERE core_id IS NULL OR core_id <> btrim(core_id)
         OR length(core_id) NOT BETWEEN 1 AND 512 OR core_id ~ '[[:cntrl:]]'
     )
     OR (SELECT count(DISTINCT core_id) FROM unnest(p_core_ids) core_id)
        <> cardinality(p_core_ids)
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10001 THEN
    RAISE EXCEPTION 'selected Core history read authority is invalid';
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
    AND active.generation_id = p_generation_id
    AND generation.observation_set_sha256 = p_observation_set_sha256
    AND generation.state = 'published'
    AND row.payload ->> 'sourceCoreId' = ANY(p_core_ids)
  ORDER BY row.ordinal
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON FUNCTION dna.read_selected_dna_core_race_history_rows(uuid,character,character,text[],integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_selected_dna_core_race_history_rows(uuid,character,character,text[],integer) TO dna_app_runtime;

COMMIT;
