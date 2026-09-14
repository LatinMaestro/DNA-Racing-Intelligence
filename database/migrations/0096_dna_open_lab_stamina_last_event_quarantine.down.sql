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
  v_special jsonb;
BEGIN
  IF jsonb_typeof(p_canonical) <> 'object'
     OR p_canonical ->> 'sourceCoreId' IS DISTINCT FROM p_source_core_id THEN
    RAISE EXCEPTION 'DNA Open Lab supplemental Core canonical identity is invalid';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_canonical);

  IF p_family = 'racingStats' THEN
    IF v_key_count <> 6
       OR p_canonical ->> 'sourceType' <> 'core_racing_stats_snapshot'
       OR NOT (p_canonical ?& ARRAY[
         'sourceType', 'sourceCoreId', 'statsByMode', 'ageingSourceValue',
         'isMaiden', 'tournamentProfitsSourceValue'
       ])
       OR jsonb_typeof(p_canonical -> 'statsByMode') <> 'object'
       OR jsonb_typeof(p_canonical -> 'isMaiden') <> 'boolean'
       OR (SELECT count(*) FROM jsonb_object_keys(p_canonical -> 'statsByMode')) <> 3
       OR NOT ((p_canonical -> 'statsByMode') ?& ARRAY['bike', 'car', 'horse']) THEN
      RAISE EXCEPTION 'DNA Open Lab racing-stats canonical payload is invalid';
    END IF;
  ELSIF p_family = 'power' THEN
    IF v_key_count <> 4
       OR p_canonical ->> 'sourceType' <> 'core_power_snapshot'
       OR NOT (p_canonical ?& ARRAY[
         'sourceType', 'sourceCoreId', 'byMode', 'aggregateStatsSourceValue'
       ])
       OR jsonb_typeof(p_canonical -> 'byMode') <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_canonical -> 'byMode')) <> 3
       OR NOT ((p_canonical -> 'byMode') ?& ARRAY['bike', 'car', 'horse']) THEN
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
  ELSIF p_family = 'listings' THEN
    IF v_key_count NOT BETWEEN 2 AND 5
       OR p_canonical ->> 'sourceType' <> 'core_listing_snapshot'
       OR NOT (p_canonical ?& ARRAY['sourceType', 'sourceCoreId'])
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_canonical) AS key(name)
         WHERE key.name NOT IN (
           'sourceType', 'sourceCoreId', 'priceSourceValue',
           'paymentAssetSourceValue', 'expiresAt'
         )
       )
       OR (p_canonical ? 'priceSourceValue' AND (
         jsonb_typeof(p_canonical -> 'priceSourceValue') <> 'number'
         OR (p_canonical ->> 'priceSourceValue')::numeric < 0
       ))
       OR (p_canonical ? 'paymentAssetSourceValue' AND (
         jsonb_typeof(p_canonical -> 'paymentAssetSourceValue') <> 'string'
         OR length(p_canonical ->> 'paymentAssetSourceValue') < 1
       ))
       OR (p_canonical ? 'expiresAt'
         AND jsonb_typeof(p_canonical -> 'expiresAt') <> 'string') THEN
      RAISE EXCEPTION 'DNA Open Lab listing canonical payload is invalid';
    END IF;
    IF p_canonical ? 'expiresAt' THEN
      PERFORM (p_canonical ->> 'expiresAt')::timestamptz;
    END IF;
  ELSIF p_family = 'attachedAssets' THEN
    IF v_key_count <> 4
       OR p_canonical ->> 'sourceType' <> 'core_attached_assets_snapshot'
       OR NOT (p_canonical ?& ARRAY[
         'sourceType', 'sourceCoreId', 'skinSourceValueByMode',
         'trailsSourceValue'
       ])
       OR jsonb_typeof(p_canonical -> 'skinSourceValueByMode') <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(
         p_canonical -> 'skinSourceValueByMode'
       )) <> 3
       OR NOT ((p_canonical -> 'skinSourceValueByMode') ?& ARRAY[
         'bike', 'car', 'horse'
       ]) THEN
      RAISE EXCEPTION 'DNA Open Lab attached-assets canonical payload is invalid';
    END IF;
  ELSIF p_family = 'owners' THEN
    IF v_key_count <> 3
       OR p_canonical ->> 'sourceType' <> 'core_owner_snapshot'
       OR NOT (p_canonical ?& ARRAY[
         'sourceType', 'sourceCoreId', 'vaultSourceValue'
       ])
       OR jsonb_typeof(p_canonical -> 'vaultSourceValue') <> 'string'
       OR length(p_canonical ->> 'vaultSourceValue') NOT BETWEEN 1 AND 512
       OR p_canonical ->> 'vaultSourceValue' ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'DNA Open Lab owner canonical payload is invalid';
    END IF;
  ELSIF p_family = 'stamina' THEN
    IF v_key_count <> 7
       OR p_canonical ->> 'sourceType' <> 'core_stamina_snapshot'
       OR NOT (p_canonical ?& ARRAY[
         'sourceType', 'sourceCoreId', 'current', 'maximum',
         'nextRefillAt', 'lastEventAt', 'special'
       ])
       OR jsonb_typeof(p_canonical -> 'current') <> 'number'
       OR jsonb_typeof(p_canonical -> 'maximum') <> 'number'
       OR (p_canonical ->> 'current')::numeric < 0
       OR (p_canonical ->> 'maximum')::numeric < 0
       OR jsonb_typeof(p_canonical -> 'nextRefillAt') NOT IN ('null', 'string')
       OR jsonb_typeof(p_canonical -> 'lastEventAt') NOT IN ('null', 'string')
       OR jsonb_typeof(p_canonical -> 'special') NOT IN ('null', 'object') THEN
      RAISE EXCEPTION 'DNA Open Lab stamina canonical payload is invalid';
    END IF;
    IF jsonb_typeof(p_canonical -> 'nextRefillAt') = 'string' THEN
      PERFORM (p_canonical ->> 'nextRefillAt')::timestamptz;
    END IF;
    IF jsonb_typeof(p_canonical -> 'lastEventAt') = 'string' THEN
      PERFORM (p_canonical ->> 'lastEventAt')::timestamptz;
    END IF;
    v_special := p_canonical -> 'special';
    IF jsonb_typeof(v_special) = 'object' AND (
      (SELECT count(*) FROM jsonb_object_keys(v_special)) NOT BETWEEN 2 AND 3
      OR NOT (v_special ?& ARRAY['sourceGiveId', 'current'])
      OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_special) AS key(name)
        WHERE key.name NOT IN ('sourceGiveId', 'current', 'maximum')
      )
      OR jsonb_typeof(v_special -> 'sourceGiveId') <> 'string'
      OR length(v_special ->> 'sourceGiveId') < 1
      OR jsonb_typeof(v_special -> 'current') <> 'number'
      OR (v_special ->> 'current')::numeric < 0
      OR (v_special ? 'maximum' AND (
        jsonb_typeof(v_special -> 'maximum') <> 'number'
        OR (v_special ->> 'maximum')::numeric < 0
      ))
    ) THEN
      RAISE EXCEPTION 'DNA Open Lab special-stamina canonical payload is invalid';
    END IF;
  ELSIF p_family = 'splicing' THEN
    IF v_key_count <> 6
       OR p_canonical ->> 'sourceType' <> 'core_splicing_snapshot'
       OR NOT (p_canonical ?& ARRAY[
         'sourceType', 'sourceCoreId', 'parentsSourceValue',
         'grandparentsSourceValue', 'challengeCreditSourceValue',
         'spliceCoreSourceValue'
       ]) THEN
      RAISE EXCEPTION 'DNA Open Lab splicing canonical payload is invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'DNA Open Lab supplemental Core family is invalid';
  END IF;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
  RAISE EXCEPTION 'DNA Open Lab supplemental Core canonical value is invalid';
END
$function$;

COMMIT;
