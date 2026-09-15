BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_updated text;
  v_old text := $old$
    PERFORM dna.validate_dna_open_lab_active_race_canonical(
      v_source_race_id,
      v_canonical
    );
    IF length(v_source_race_id) NOT BETWEEN 1 AND 512
       OR v_source_race_id ~ '[[:cntrl:]]'
       OR v_row ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'DNA Open Lab active-race row is out of bounds';
    END IF;
$old$;
  v_new text := $new$
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_canonical);
    IF v_key_count <> 12 OR NOT (
      v_canonical ? 'sourceType' AND v_canonical ? 'sourceRaceId'
      AND v_canonical ? 'status' AND v_canonical ? 'displayName'
      AND v_canonical ? 'mode' AND v_canonical ? 'format'
      AND v_canonical ? 'raceClassSourceValue'
      AND v_canonical ? 'fixedFeesByAsset' AND v_canonical ? 'entryFeeUsd'
      AND v_canonical ? 'paymentAsset' AND v_canonical ? 'startAt'
      AND v_canonical ? 'endAt'
    ) OR v_canonical ->> 'sourceType' <> 'active_race_snapshot'
      OR v_canonical ->> 'sourceRaceId' <> v_source_race_id
      OR jsonb_typeof(v_canonical -> 'status') <> 'string'
      OR jsonb_typeof(v_canonical -> 'displayName') <> 'string'
      OR v_canonical ->> 'mode' NOT IN ('bike', 'car', 'horse')
      OR NOT (jsonb_typeof(v_canonical -> 'format') IN ('null', 'string'))
      OR NOT (jsonb_typeof(v_canonical -> 'raceClassSourceValue') IN ('null', 'string', 'number'))
      OR jsonb_typeof(v_canonical -> 'fixedFeesByAsset') <> 'object'
      OR jsonb_typeof(v_canonical -> 'entryFeeUsd') <> 'number'
      OR (v_canonical ->> 'entryFeeUsd')::numeric < 0
      OR jsonb_typeof(v_canonical -> 'paymentAsset') <> 'string'
      OR NOT (jsonb_typeof(v_canonical -> 'startAt') IN ('null', 'string'))
      OR NOT (jsonb_typeof(v_canonical -> 'endAt') IN ('null', 'string'))
      OR length(v_source_race_id) NOT BETWEEN 1 AND 512
      OR v_source_race_id ~ '[[:cntrl:]]'
      OR v_row ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'DNA Open Lab active-race row is out of bounds';
    END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(
    'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) INTO v_definition;
  IF length(v_definition) - length(replace(v_definition, v_old, ''))
       <> length(v_old) THEN
    RAISE EXCEPTION 'active-race validator reversal target is missing or ambiguous';
  END IF;
  v_updated := replace(v_definition, v_old, v_new);
  EXECUTE v_updated;
END
$migration$;

DROP FUNCTION dna.validate_dna_open_lab_active_race_canonical(text, jsonb);

COMMIT;
