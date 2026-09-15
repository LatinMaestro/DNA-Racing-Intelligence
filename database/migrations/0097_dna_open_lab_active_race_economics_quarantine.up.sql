BEGIN;

CREATE FUNCTION dna.validate_dna_open_lab_active_race_canonical(
  p_source_race_id text,
  p_canonical jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
BEGIN
  IF jsonb_typeof(p_canonical) <> 'object' THEN
    RAISE EXCEPTION 'DNA Open Lab active-race canonical payload is invalid';
  END IF;

  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_canonical);
  IF v_key_count <> 12
     OR NOT (p_canonical ?& ARRAY[
       'sourceType', 'sourceRaceId', 'status', 'displayName', 'mode', 'format',
       'raceClassSourceValue', 'startAt', 'endAt'
     ])
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_canonical) AS key(name)
       WHERE key.name NOT IN (
         'sourceType', 'sourceRaceId', 'status', 'displayName', 'mode', 'format',
         'raceClassSourceValue', 'fixedFeesByAsset', 'fixedFeesEvidenceStatus',
         'entryFeeUsd', 'entryFeeEvidenceStatus', 'paymentAsset',
         'paymentAssetEvidenceStatus', 'startAt', 'endAt'
       )
     )
     OR jsonb_typeof(p_canonical -> 'sourceType') <> 'string'
     OR p_canonical ->> 'sourceType' <> 'active_race_snapshot'
     OR jsonb_typeof(p_canonical -> 'sourceRaceId') <> 'string'
     OR p_canonical ->> 'sourceRaceId' <> p_source_race_id
     OR jsonb_typeof(p_canonical -> 'status') <> 'string'
     OR jsonb_typeof(p_canonical -> 'displayName') <> 'string'
     OR jsonb_typeof(p_canonical -> 'mode') <> 'string'
     OR p_canonical ->> 'mode' NOT IN ('bike', 'car', 'horse')
     OR NOT (jsonb_typeof(p_canonical -> 'format') IN ('null', 'string'))
     OR NOT (jsonb_typeof(p_canonical -> 'raceClassSourceValue') IN ('null', 'string', 'number'))
     OR NOT (jsonb_typeof(p_canonical -> 'startAt') IN ('null', 'string'))
     OR NOT (jsonb_typeof(p_canonical -> 'endAt') IN ('null', 'string'))
     OR ((p_canonical ? 'fixedFeesByAsset')::integer
       + (p_canonical ? 'fixedFeesEvidenceStatus')::integer) <> 1
     OR ((p_canonical ? 'entryFeeUsd')::integer
       + (p_canonical ? 'entryFeeEvidenceStatus')::integer) <> 1
     OR ((p_canonical ? 'paymentAsset')::integer
       + (p_canonical ? 'paymentAssetEvidenceStatus')::integer) <> 1 THEN
    RAISE EXCEPTION 'DNA Open Lab active-race canonical payload is invalid';
  END IF;

  IF p_canonical ? 'fixedFeesByAsset' THEN
    IF jsonb_typeof(p_canonical -> 'fixedFeesByAsset') <> 'object'
       OR EXISTS (
         SELECT 1 FROM jsonb_each(p_canonical -> 'fixedFeesByAsset') fee(asset, amount)
         WHERE length(fee.asset) NOT BETWEEN 1 AND 512
            OR btrim(fee.asset) <> fee.asset
            OR fee.asset ~ '[[:cntrl:]]'
            OR jsonb_typeof(fee.amount) <> 'number'
            OR (fee.amount #>> '{}')::numeric < 0
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab active-race fixed fees are invalid';
    END IF;
  ELSIF jsonb_typeof(p_canonical -> 'fixedFeesEvidenceStatus') <> 'string'
     OR p_canonical ->> 'fixedFeesEvidenceStatus' <> 'unsupported_source_value' THEN
    RAISE EXCEPTION 'DNA Open Lab active-race fixed-fee evidence status is invalid';
  END IF;

  IF p_canonical ? 'entryFeeUsd' THEN
    IF jsonb_typeof(p_canonical -> 'entryFeeUsd') <> 'number'
       OR (p_canonical ->> 'entryFeeUsd')::numeric < 0 THEN
      RAISE EXCEPTION 'DNA Open Lab active-race entry fee is invalid';
    END IF;
  ELSIF jsonb_typeof(p_canonical -> 'entryFeeEvidenceStatus') <> 'string'
     OR p_canonical ->> 'entryFeeEvidenceStatus' <> 'unsupported_source_value' THEN
    RAISE EXCEPTION 'DNA Open Lab active-race entry-fee evidence status is invalid';
  END IF;

  IF p_canonical ? 'paymentAsset' THEN
    IF jsonb_typeof(p_canonical -> 'paymentAsset') <> 'string'
       OR length(p_canonical ->> 'paymentAsset') NOT BETWEEN 1 AND 512
       OR btrim(p_canonical ->> 'paymentAsset') <> p_canonical ->> 'paymentAsset'
       OR p_canonical ->> 'paymentAsset' ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'DNA Open Lab active-race payment asset is invalid';
    END IF;
  ELSIF jsonb_typeof(p_canonical -> 'paymentAssetEvidenceStatus') <> 'string'
     OR p_canonical ->> 'paymentAssetEvidenceStatus' <> 'unsupported_source_value' THEN
    RAISE EXCEPTION 'DNA Open Lab active-race payment evidence status is invalid';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION dna.validate_dna_open_lab_active_race_canonical(text, jsonb)
FROM PUBLIC;

DO $migration$
DECLARE
  v_definition text;
  v_updated text;
  v_old text := $old$
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
$old$;
  v_new text := $new$
    PERFORM dna.validate_dna_open_lab_active_race_canonical(
      v_source_race_id,
      v_canonical
    );
    IF length(v_source_race_id) NOT BETWEEN 1 AND 512
       OR v_source_race_id ~ '[[:cntrl:]]'
       OR v_row ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'DNA Open Lab active-race row is out of bounds';
    END IF;
$new$;
BEGIN
  IF to_regprocedure(
       'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)'
     ) IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_functiondef(
    'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) INTO v_definition;
  IF length(v_definition) - length(replace(v_definition, v_old, ''))
       <> length(v_old) THEN
    RAISE EXCEPTION 'active-race validator migration target is missing or ambiguous';
  END IF;
  v_updated := replace(v_definition, v_old, v_new);
  EXECUTE v_updated;
END
$migration$;

COMMIT;
