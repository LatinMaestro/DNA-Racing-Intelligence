BEGIN;

CREATE OR REPLACE FUNCTION dna.validate_dna_open_lab_supplemental_core_canonical(
  p_family text,
  p_source_core_id text,
  p_canonical jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
  v_mode text;
  v_mode_value jsonb;
BEGIN
  IF p_family <> 'power' THEN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical_strict_modes(
      p_family,
      p_source_core_id,
      p_canonical
    );
    RETURN;
  END IF;

  IF jsonb_typeof(p_canonical) <> 'object'
     OR p_canonical ->> 'sourceCoreId' IS DISTINCT FROM p_source_core_id THEN
    RAISE EXCEPTION 'DNA Open Lab supplemental Core canonical identity is invalid';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_canonical);

  IF v_key_count <> 4
     OR p_canonical ->> 'sourceType' <> 'core_power_snapshot'
     OR NOT (p_canonical ?& ARRAY[
       'sourceType', 'sourceCoreId', 'byMode', 'aggregateStatsSourceValue'
     ])
     OR jsonb_typeof(p_canonical -> 'byMode') <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(
       p_canonical -> 'byMode'
     )) NOT BETWEEN 1 AND 3
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(p_canonical -> 'byMode') AS key(name)
       WHERE key.name NOT IN ('bike', 'car', 'horse')
     ) THEN
    RAISE EXCEPTION 'DNA Open Lab power canonical payload is invalid';
  END IF;

  FOR v_mode, v_mode_value IN
    SELECT key, value FROM jsonb_each(p_canonical -> 'byMode')
  LOOP
    IF jsonb_typeof(v_mode_value) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_mode_value)) <> 4
       OR NOT (v_mode_value ?& ARRAY[
         'powerSourceValue', 'adjustedOddsSourceValue',
         'varianceSourceValue', 'raceCount'
       ])
       OR jsonb_typeof(v_mode_value -> 'raceCount') <> 'number'
       OR v_mode_value ->> 'raceCount' !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'DNA Open Lab % power canonical mode is invalid', v_mode;
    END IF;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION dna.validate_dna_open_lab_supplemental_core_canonical(
  text,
  text,
  jsonb
) FROM PUBLIC;

COMMIT;
