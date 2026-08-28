BEGIN;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT constraint_name
    INTO v_constraint_name
    FROM information_schema.check_constraints
    JOIN information_schema.constraint_column_usage
      USING (constraint_catalog, constraint_schema, constraint_name)
   WHERE constraint_schema = 'dna'
     AND table_name = 'dna_open_lab_sync_generation'
     AND column_name = 'materialization_contract_version';

  IF v_constraint_name IS NULL THEN
    RAISE EXCEPTION 'materialization contract version constraint is missing';
  END IF;

  EXECUTE format(
    'ALTER TABLE dna.dna_open_lab_sync_generation DROP CONSTRAINT %I',
    v_constraint_name
  );
END;
$$;
ALTER TABLE dna.dna_open_lab_sync_generation
  ADD CONSTRAINT dna_open_lab_sync_generation_materialization_version_check
  CHECK (materialization_contract_version BETWEEN 0 AND 3);

CREATE TABLE dna.dna_open_lab_core_supplemental_snapshot (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  source_core_id bigint NOT NULL CHECK (
    source_core_id BETWEEN 1 AND 9007199254740991
  ),
  family text NOT NULL CHECK (family IN (
    'racing_stats', 'power', 'listing', 'attached_assets',
    'owner', 'stamina', 'splicing'
  )),
  observed_at timestamptz NOT NULL,
  raw_evidence_sha256 character(64) NOT NULL CHECK (
    raw_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  canonical jsonb NOT NULL CHECK (jsonb_typeof(canonical) = 'object'),
  PRIMARY KEY (owner_id, generation_id, source_core_id, family),
  FOREIGN KEY (owner_id, generation_id, source_core_id)
    REFERENCES dna.dna_open_lab_owned_core_snapshot(
      owner_id, generation_id, source_core_id
    ) ON DELETE CASCADE
);

ALTER TABLE dna.dna_open_lab_core_supplemental_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_core_supplemental_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_core_supplemental_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.validate_dna_open_lab_supplemental_core_canonical(
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

CREATE FUNCTION dna.stage_dna_open_lab_supplemental_core_candidate(
  p_owner_id uuid,
  p_generation_id uuid,
  p_observed_at timestamptz,
  p_recorded_at timestamptz,
  p_families jsonb,
  p_owned_cores jsonb,
  p_active_races jsonb,
  p_race_fills jsonb,
  p_supplemental jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_status text;
  v_generation dna.dna_open_lab_sync_generation%ROWTYPE;
  v_family_key text;
  v_expected_source_type text;
  v_rows jsonb;
  v_row jsonb;
  v_key_count integer;
  v_core_count integer;
  v_source_core_id text;
  v_row_observed_at timestamptz;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab supplemental Core materialization denied';
  END IF;
  IF jsonb_typeof(p_owned_cores) <> 'array'
     OR jsonb_typeof(p_supplemental) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_supplemental)) <> 7
     OR NOT (p_supplemental ?& ARRAY[
       'racingStats', 'power', 'listings', 'attachedAssets',
       'owners', 'stamina', 'splicing'
     ]) THEN
    RAISE EXCEPTION 'DNA Open Lab supplemental Core family set is invalid';
  END IF;
  v_core_count := jsonb_array_length(p_owned_cores);

  FOR v_family_key, v_rows IN SELECT key, value FROM jsonb_each(p_supplemental)
  LOOP
    v_expected_source_type := CASE v_family_key
      WHEN 'racingStats' THEN 'core_racing_stats_snapshot'
      WHEN 'power' THEN 'core_power_snapshot'
      WHEN 'listings' THEN 'core_listing_snapshot'
      WHEN 'attachedAssets' THEN 'core_attached_assets_snapshot'
      WHEN 'owners' THEN 'core_owner_snapshot'
      WHEN 'stamina' THEN 'core_stamina_snapshot'
      WHEN 'splicing' THEN 'core_splicing_snapshot'
    END;
    IF jsonb_typeof(v_rows) <> 'array'
       OR jsonb_array_length(v_rows) <> v_core_count
       OR jsonb_array_length(v_rows) > 10000
       OR (SELECT count(*) FROM (
         SELECT DISTINCT value ->> 'sourceCoreId'
         FROM jsonb_array_elements(v_rows)
       ) ids) <> v_core_count THEN
      RAISE EXCEPTION 'DNA Open Lab % family coverage is invalid', v_family_key;
    END IF;

    FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows)
    LOOP
      IF jsonb_typeof(v_row) <> 'object' THEN
        RAISE EXCEPTION 'DNA Open Lab supplemental Core row is invalid';
      END IF;
      SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_row);
      IF v_key_count <> 4 OR NOT (v_row ?& ARRAY[
        'sourceCoreId', 'observedAt', 'rawEvidenceSha256', 'canonical'
      ]) OR jsonb_typeof(v_row -> 'sourceCoreId') <> 'string'
        OR v_row ->> 'sourceCoreId' !~ '^[1-9][0-9]*$'
        OR length(v_row ->> 'sourceCoreId') > 16
        OR (v_row ->> 'sourceCoreId')::numeric > 9007199254740991
        OR jsonb_typeof(v_row -> 'observedAt') <> 'string'
        OR jsonb_typeof(v_row -> 'rawEvidenceSha256') <> 'string'
        OR v_row ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$'
        OR jsonb_typeof(v_row -> 'canonical') <> 'object' THEN
        RAISE EXCEPTION 'DNA Open Lab supplemental Core row fields are invalid';
      END IF;
      v_source_core_id := v_row ->> 'sourceCoreId';
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_owned_cores) core
        WHERE core ->> 'sourceCoreId' = v_source_core_id
      ) OR v_row -> 'canonical' ->> 'sourceType' <> v_expected_source_type THEN
        RAISE EXCEPTION 'DNA Open Lab supplemental Core ownership is invalid';
      END IF;
      BEGIN
        v_row_observed_at := (v_row ->> 'observedAt')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'DNA Open Lab supplemental Core observation time is invalid';
      END;
      IF v_row_observed_at > p_observed_at THEN
        RAISE EXCEPTION 'DNA Open Lab supplemental Core chronology is invalid';
      END IF;
      PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
        v_family_key, v_source_core_id, v_row -> 'canonical'
      );
    END LOOP;
  END LOOP;

  SELECT generation.* INTO v_generation
  FROM dna.dna_open_lab_sync_generation generation
  WHERE generation.owner_id = p_owner_id AND generation.id = p_generation_id;

  IF FOUND AND v_generation.status = 'published' THEN
    v_status := dna.stage_dna_open_lab_sync_candidate(
      p_owner_id, p_generation_id, p_observed_at, p_recorded_at, p_families
    );
    IF v_status <> 'published'
       OR v_generation.materialization_contract_version <> 3
       OR (SELECT count(*) FROM dna.dna_open_lab_owned_core_snapshot core
         WHERE core.owner_id = p_owner_id AND core.generation_id = p_generation_id)
         <> jsonb_array_length(p_owned_cores)
       OR (SELECT count(*) FROM dna.dna_open_lab_active_race_snapshot race
         WHERE race.owner_id = p_owner_id AND race.generation_id = p_generation_id)
         <> jsonb_array_length(p_active_races)
       OR (SELECT count(*) FROM dna.dna_open_lab_race_fill_snapshot fill
         WHERE fill.owner_id = p_owner_id AND fill.generation_id = p_generation_id)
         <> jsonb_array_length(p_race_fills)
       OR (SELECT count(*) FROM dna.dna_open_lab_core_supplemental_snapshot snapshot
         WHERE snapshot.owner_id = p_owner_id AND snapshot.generation_id = p_generation_id)
         <> v_core_count * 7
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_owned_cores) requested
         LEFT JOIN dna.dna_open_lab_owned_core_snapshot stored
           ON stored.owner_id = p_owner_id
           AND stored.generation_id = p_generation_id
           AND stored.source_core_id = (requested ->> 'sourceCoreId')::bigint
         WHERE stored.source_core_id IS NULL
           OR stored.display_name IS DISTINCT FROM requested ->> 'displayName'
           OR stored.core_class IS DISTINCT FROM requested ->> 'coreClass'
           OR stored.element IS DISTINCT FROM requested ->> 'element'
           OR stored.f_number IS DISTINCT FROM (requested ->> 'fNumber')::integer
           OR stored.sex IS DISTINCT FROM requested ->> 'sex'
           OR stored.color_source_value IS DISTINCT FROM requested ->> 'colorSourceValue'
           OR stored.observed_at IS DISTINCT FROM (requested ->> 'observedAt')::timestamptz
           OR stored.raw_evidence_sha256 IS DISTINCT FROM requested ->> 'rawEvidenceSha256'
       ) OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_active_races) requested
         LEFT JOIN dna.dna_open_lab_active_race_snapshot stored
           ON stored.owner_id = p_owner_id
           AND stored.generation_id = p_generation_id
           AND stored.source_race_id = requested ->> 'sourceRaceId'
         WHERE stored.source_race_id IS NULL
           OR stored.observed_at IS DISTINCT FROM (requested ->> 'observedAt')::timestamptz
           OR stored.raw_evidence_sha256 IS DISTINCT FROM requested ->> 'rawEvidenceSha256'
           OR stored.canonical IS DISTINCT FROM requested -> 'canonical'
       ) OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_race_fills) requested
         LEFT JOIN dna.dna_open_lab_race_fill_snapshot stored
           ON stored.owner_id = p_owner_id
           AND stored.generation_id = p_generation_id
           AND stored.source_race_id = requested ->> 'sourceRaceId'
         WHERE stored.source_race_id IS NULL
           OR stored.observed_at IS DISTINCT FROM (requested ->> 'observedAt')::timestamptz
           OR stored.raw_evidence_sha256 IS DISTINCT FROM requested ->> 'rawEvidenceSha256'
           OR stored.canonical IS DISTINCT FROM requested -> 'canonical'
       ) OR EXISTS (
         SELECT 1
         FROM jsonb_each(p_supplemental) requested_family
         CROSS JOIN LATERAL jsonb_array_elements(requested_family.value) requested
         LEFT JOIN dna.dna_open_lab_core_supplemental_snapshot stored
           ON stored.owner_id = p_owner_id
           AND stored.generation_id = p_generation_id
           AND stored.source_core_id = (requested ->> 'sourceCoreId')::bigint
           AND stored.family = CASE requested_family.key
             WHEN 'racingStats' THEN 'racing_stats'
             WHEN 'power' THEN 'power'
             WHEN 'listings' THEN 'listing'
             WHEN 'attachedAssets' THEN 'attached_assets'
             WHEN 'owners' THEN 'owner'
             WHEN 'stamina' THEN 'stamina'
             WHEN 'splicing' THEN 'splicing'
           END
         WHERE stored.source_core_id IS NULL
           OR stored.observed_at IS DISTINCT FROM (requested ->> 'observedAt')::timestamptz
           OR stored.raw_evidence_sha256 IS DISTINCT FROM requested ->> 'rawEvidenceSha256'
           OR stored.canonical IS DISTINCT FROM requested -> 'canonical'
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab published supplemental Core replay conflict';
    END IF;
    RETURN 'published';
  END IF;

  v_status := dna.stage_dna_open_lab_current_race_candidate(
    p_owner_id, p_generation_id, p_observed_at, p_recorded_at,
    p_families, p_owned_cores, p_active_races, p_race_fills
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'DNA Open Lab supplemental Core generation was not staged';
  END IF;
  DELETE FROM dna.dna_open_lab_core_supplemental_snapshot
  WHERE owner_id = p_owner_id AND generation_id = p_generation_id;
  INSERT INTO dna.dna_open_lab_core_supplemental_snapshot (
    owner_id, generation_id, source_core_id, family, observed_at,
    raw_evidence_sha256, canonical
  )
  SELECT p_owner_id, p_generation_id,
    (entry ->> 'sourceCoreId')::bigint,
    CASE family.key
      WHEN 'racingStats' THEN 'racing_stats'
      WHEN 'power' THEN 'power'
      WHEN 'listings' THEN 'listing'
      WHEN 'attachedAssets' THEN 'attached_assets'
      WHEN 'owners' THEN 'owner'
      WHEN 'stamina' THEN 'stamina'
      WHEN 'splicing' THEN 'splicing'
    END,
    (entry ->> 'observedAt')::timestamptz,
    (entry ->> 'rawEvidenceSha256')::character(64), entry -> 'canonical'
  FROM jsonb_each(p_supplemental) family
  CROSS JOIN LATERAL jsonb_array_elements(family.value) entry;
  UPDATE dna.dna_open_lab_sync_generation
  SET materialization_contract_version = 3
  WHERE owner_id = p_owner_id AND id = p_generation_id;
  RETURN 'staged';
END
$function$;

CREATE OR REPLACE FUNCTION dna.enforce_dna_open_lab_materialized_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_expected bigint;
  v_actual bigint;
  v_distinct_families bigint;
BEGIN
  IF OLD.status = 'staged' AND NEW.status = 'published'
     AND NEW.materialization_contract_version >= 1 THEN
    SELECT family.item_count INTO v_expected
    FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'cores' AND family.status = 'complete';
    SELECT count(*) INTO v_actual FROM dna.dna_open_lab_owned_core_snapshot snapshot
    WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id;
    IF v_expected IS NULL OR v_expected <> v_actual THEN
      RAISE EXCEPTION 'DNA Open Lab owned Core materialization is incomplete';
    END IF;
  END IF;
  IF OLD.status = 'staged' AND NEW.status = 'published'
     AND NEW.materialization_contract_version >= 2 THEN
    SELECT family.item_count INTO v_expected
    FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'active_races' AND family.status = 'complete';
    SELECT count(*) INTO v_actual FROM dna.dna_open_lab_active_race_snapshot snapshot
    WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id;
    IF v_expected IS NULL OR v_expected <> v_actual THEN
      RAISE EXCEPTION 'DNA Open Lab active-race materialization is incomplete';
    END IF;
    SELECT family.item_count INTO v_expected
    FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'race_fills' AND family.status = 'complete';
    SELECT count(*) INTO v_actual FROM dna.dna_open_lab_race_fill_snapshot snapshot
    WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id;
    IF v_expected IS NULL OR v_expected <> v_actual THEN
      RAISE EXCEPTION 'DNA Open Lab race-fill materialization is incomplete';
    END IF;
  END IF;
  IF OLD.status = 'staged' AND NEW.status = 'published'
     AND NEW.materialization_contract_version >= 3 THEN
    SELECT family.item_count INTO v_expected
    FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'cores' AND family.status = 'complete';
    SELECT count(*), count(DISTINCT snapshot.family)
      INTO v_actual, v_distinct_families
    FROM dna.dna_open_lab_core_supplemental_snapshot snapshot
    WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id;
    IF v_expected IS NULL OR v_actual <> v_expected * 7
       OR (v_expected > 0 AND v_distinct_families <> 7)
       OR EXISTS (
         SELECT 1 FROM dna.dna_open_lab_core_supplemental_snapshot snapshot
         WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id
         GROUP BY snapshot.family HAVING count(*) <> v_expected
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab supplemental Core materialization is incomplete';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_serving_supplemental_cores(p_owner_id uuid)
RETURNS TABLE (
  generation_id uuid, source_core_id bigint, family text,
  observed_at timestamptz, raw_evidence_sha256 character(64), canonical jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab supplemental Core read denied';
  END IF;
  RETURN QUERY SELECT snapshot.generation_id, snapshot.source_core_id,
    snapshot.family, snapshot.observed_at, snapshot.raw_evidence_sha256,
    snapshot.canonical
  FROM dna.dna_open_lab_sync_state state
  JOIN dna.dna_open_lab_core_supplemental_snapshot snapshot
    ON snapshot.owner_id = state.owner_id
    AND snapshot.generation_id = state.serving_generation_id
  WHERE state.owner_id = p_owner_id
  ORDER BY snapshot.family, snapshot.source_core_id;
END
$function$;

REVOKE ALL ON TABLE dna.dna_open_lab_core_supplemental_snapshot FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.validate_dna_open_lab_supplemental_core_canonical(
  text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.stage_dna_open_lab_supplemental_core_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_serving_supplemental_cores(uuid)
FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION dna.stage_dna_open_lab_current_race_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb
) FROM dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.stage_dna_open_lab_supplemental_core_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_serving_supplemental_cores(uuid)
TO dna_app_runtime;

COMMIT;
