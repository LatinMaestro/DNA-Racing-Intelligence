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
  CHECK (materialization_contract_version BETWEEN 0 AND 2);

CREATE TABLE dna.dna_open_lab_active_race_snapshot (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  source_race_id text NOT NULL CHECK (
    length(source_race_id) BETWEEN 1 AND 512
    AND source_race_id !~ '[[:cntrl:]]'
  ),
  observed_at timestamptz NOT NULL,
  raw_evidence_sha256 character(64) NOT NULL CHECK (
    raw_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  canonical jsonb NOT NULL CHECK (jsonb_typeof(canonical) = 'object'),
  PRIMARY KEY (owner_id, generation_id, source_race_id),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id)
    ON DELETE CASCADE
);

CREATE TABLE dna.dna_open_lab_race_fill_snapshot (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  source_race_id text NOT NULL CHECK (
    length(source_race_id) BETWEEN 1 AND 512
    AND source_race_id !~ '[[:cntrl:]]'
  ),
  observed_at timestamptz NOT NULL,
  raw_evidence_sha256 character(64) NOT NULL CHECK (
    raw_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  canonical jsonb NOT NULL CHECK (jsonb_typeof(canonical) = 'object'),
  PRIMARY KEY (owner_id, generation_id, source_race_id),
  FOREIGN KEY (owner_id, generation_id, source_race_id)
    REFERENCES dna.dna_open_lab_active_race_snapshot(
      owner_id, generation_id, source_race_id
    ) ON DELETE CASCADE
);

ALTER TABLE dna.dna_open_lab_active_race_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_active_race_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_active_race_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_race_fill_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_race_fill_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_race_fill_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.stage_dna_open_lab_current_race_candidate(
  p_owner_id uuid,
  p_generation_id uuid,
  p_observed_at timestamptz,
  p_recorded_at timestamptz,
  p_families jsonb,
  p_owned_cores jsonb,
  p_active_races jsonb,
  p_race_fills jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_status text;
  v_generation dna.dna_open_lab_sync_generation%ROWTYPE;
  v_row jsonb;
  v_canonical jsonb;
  v_key_count integer;
  v_active_count integer;
  v_fill_count integer;
  v_expected_active_count bigint;
  v_expected_fill_count bigint;
  v_source_race_id text;
  v_row_observed_at timestamptz;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_gate_count integer;
  v_filled_gate_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab current-race materialization denied';
  END IF;
  IF jsonb_typeof(p_active_races) <> 'array'
     OR jsonb_typeof(p_race_fills) <> 'array'
     OR jsonb_array_length(p_active_races) > 10000
     OR jsonb_array_length(p_race_fills) > 10000 THEN
    RAISE EXCEPTION 'DNA Open Lab current-race snapshots are invalid';
  END IF;
  IF jsonb_typeof(p_families) <> 'object'
     OR jsonb_typeof(p_families -> 'active_races') <> 'object'
     OR jsonb_typeof(p_families -> 'race_fills') <> 'object'
     OR p_families -> 'active_races' ->> 'status' <> 'complete'
     OR p_families -> 'race_fills' ->> 'status' <> 'complete'
     OR p_families -> 'active_races' ->> 'itemCount' !~ '^[0-9]+$'
     OR p_families -> 'race_fills' ->> 'itemCount' !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'DNA Open Lab current-race family receipts are invalid';
  END IF;
  v_expected_active_count :=
    (p_families -> 'active_races' ->> 'itemCount')::bigint;
  v_expected_fill_count :=
    (p_families -> 'race_fills' ->> 'itemCount')::bigint;
  v_active_count := jsonb_array_length(p_active_races);
  v_fill_count := jsonb_array_length(p_race_fills);
  IF v_expected_active_count <> v_active_count
     OR v_expected_fill_count <> v_fill_count THEN
    RAISE EXCEPTION 'DNA Open Lab current-race counts do not match family receipts';
  END IF;

  IF (SELECT count(*) FROM (
    SELECT DISTINCT value ->> 'sourceRaceId'
    FROM jsonb_array_elements(p_active_races)
  ) ids) <> v_active_count OR (SELECT count(*) FROM (
    SELECT DISTINCT value ->> 'sourceRaceId'
    FROM jsonb_array_elements(p_race_fills)
  ) ids) <> v_fill_count THEN
    RAISE EXCEPTION 'DNA Open Lab current-race snapshots contain duplicate IDs';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_active_races)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'DNA Open Lab active-race row is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_row);
    IF v_key_count <> 4 OR NOT (
      v_row ? 'sourceRaceId' AND v_row ? 'observedAt'
      AND v_row ? 'rawEvidenceSha256' AND v_row ? 'canonical'
    ) OR jsonb_typeof(v_row -> 'sourceRaceId') <> 'string'
      OR jsonb_typeof(v_row -> 'observedAt') <> 'string'
      OR jsonb_typeof(v_row -> 'rawEvidenceSha256') <> 'string'
      OR jsonb_typeof(v_row -> 'canonical') <> 'object' THEN
      RAISE EXCEPTION 'DNA Open Lab active-race row fields are invalid';
    END IF;
    v_source_race_id := v_row ->> 'sourceRaceId';
    v_canonical := v_row -> 'canonical';
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
    BEGIN
      v_row_observed_at := (v_row ->> 'observedAt')::timestamptz;
      v_start_at := CASE WHEN jsonb_typeof(v_canonical -> 'startAt') = 'null'
        THEN NULL ELSE (v_canonical ->> 'startAt')::timestamptz END;
      v_end_at := CASE WHEN jsonb_typeof(v_canonical -> 'endAt') = 'null'
        THEN NULL ELSE (v_canonical ->> 'endAt')::timestamptz END;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'DNA Open Lab active-race timestamps are invalid';
    END;
    IF v_row_observed_at > p_observed_at
       OR (v_start_at IS NOT NULL AND v_end_at IS NOT NULL
         AND v_end_at < v_start_at) THEN
      RAISE EXCEPTION 'DNA Open Lab active-race chronology is invalid';
    END IF;
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_race_fills)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'DNA Open Lab race-fill row is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_row);
    IF v_key_count <> 4 OR NOT (
      v_row ? 'sourceRaceId' AND v_row ? 'observedAt'
      AND v_row ? 'rawEvidenceSha256' AND v_row ? 'canonical'
    ) OR jsonb_typeof(v_row -> 'sourceRaceId') <> 'string'
      OR jsonb_typeof(v_row -> 'observedAt') <> 'string'
      OR jsonb_typeof(v_row -> 'rawEvidenceSha256') <> 'string'
      OR jsonb_typeof(v_row -> 'canonical') <> 'object' THEN
      RAISE EXCEPTION 'DNA Open Lab race-fill row fields are invalid';
    END IF;
    v_source_race_id := v_row ->> 'sourceRaceId';
    v_canonical := v_row -> 'canonical';
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_canonical);
    IF v_key_count <> 7 OR NOT (
      v_canonical ? 'sourceType' AND v_canonical ? 'sourceRaceId'
      AND v_canonical ? 'status' AND v_canonical ? 'gateCount'
      AND v_canonical ? 'filledGateCount' AND v_canonical ? 'entrantCoreIds'
      AND v_canonical ? 'entryConfirmationsBySourceKey'
    ) OR v_canonical ->> 'sourceType' <> 'race_fill_snapshot'
      OR v_canonical ->> 'sourceRaceId' <> v_source_race_id
      OR jsonb_typeof(v_canonical -> 'status') <> 'string'
      OR jsonb_typeof(v_canonical -> 'gateCount') <> 'number'
      OR jsonb_typeof(v_canonical -> 'filledGateCount') <> 'number'
      OR v_canonical ->> 'gateCount' !~ '^[1-9][0-9]*$'
      OR v_canonical ->> 'filledGateCount' !~ '^[0-9]+$'
      OR jsonb_typeof(v_canonical -> 'entrantCoreIds') <> 'array'
      OR jsonb_typeof(v_canonical -> 'entryConfirmationsBySourceKey') <> 'object'
      OR length(v_source_race_id) NOT BETWEEN 1 AND 512
      OR v_source_race_id ~ '[[:cntrl:]]'
      OR v_row ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'DNA Open Lab race-fill row is out of bounds';
    END IF;
    v_gate_count := (v_canonical ->> 'gateCount')::integer;
    v_filled_gate_count := (v_canonical ->> 'filledGateCount')::integer;
    BEGIN
      v_row_observed_at := (v_row ->> 'observedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'DNA Open Lab race-fill observation time is invalid';
    END;
    IF v_gate_count > 10000 OR v_filled_gate_count > v_gate_count
       OR jsonb_array_length(v_canonical -> 'entrantCoreIds') <> v_filled_gate_count
       OR v_row_observed_at > p_observed_at
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_active_races) active
         WHERE active ->> 'sourceRaceId' = v_source_race_id
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab race-fill coverage is invalid';
    END IF;
  END LOOP;

  SELECT generation.* INTO v_generation
  FROM dna.dna_open_lab_sync_generation generation
  WHERE generation.owner_id = p_owner_id AND generation.id = p_generation_id;

  IF FOUND AND v_generation.status = 'published' THEN
    v_status := dna.stage_dna_open_lab_sync_candidate(
      p_owner_id, p_generation_id, p_observed_at, p_recorded_at, p_families
    );
    IF v_status <> 'published'
       OR v_generation.materialization_contract_version <> 2
       OR (SELECT count(*) FROM dna.dna_open_lab_owned_core_snapshot core
         WHERE core.owner_id = p_owner_id AND core.generation_id = p_generation_id)
         <> jsonb_array_length(p_owned_cores)
       OR (SELECT count(*) FROM dna.dna_open_lab_active_race_snapshot race
         WHERE race.owner_id = p_owner_id AND race.generation_id = p_generation_id)
         <> v_active_count
       OR (SELECT count(*) FROM dna.dna_open_lab_race_fill_snapshot fill
         WHERE fill.owner_id = p_owner_id AND fill.generation_id = p_generation_id)
         <> v_fill_count
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_owned_cores) requested
         LEFT JOIN dna.dna_open_lab_owned_core_snapshot stored
           ON stored.owner_id = p_owner_id
           AND stored.generation_id = p_generation_id
           AND stored.source_core_id = (requested ->> 'sourceCoreId')::bigint
         WHERE stored.source_core_id IS NULL
           OR stored.display_name <> requested ->> 'displayName'
           OR stored.core_class <> requested ->> 'coreClass'
           OR stored.element <> requested ->> 'element'
           OR stored.f_number <> (requested ->> 'fNumber')::integer
           OR stored.sex <> requested ->> 'sex'
           OR stored.color_source_value IS DISTINCT FROM requested ->> 'colorSourceValue'
           OR stored.observed_at <> (requested ->> 'observedAt')::timestamptz
           OR stored.raw_evidence_sha256 <> requested ->> 'rawEvidenceSha256'
       ) OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_active_races) requested
         LEFT JOIN dna.dna_open_lab_active_race_snapshot stored
           ON stored.owner_id = p_owner_id
           AND stored.generation_id = p_generation_id
           AND stored.source_race_id = requested ->> 'sourceRaceId'
         WHERE stored.source_race_id IS NULL
           OR stored.observed_at <> (requested ->> 'observedAt')::timestamptz
           OR stored.raw_evidence_sha256 <> requested ->> 'rawEvidenceSha256'
           OR stored.canonical <> requested -> 'canonical'
       ) OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_race_fills) requested
         LEFT JOIN dna.dna_open_lab_race_fill_snapshot stored
           ON stored.owner_id = p_owner_id
           AND stored.generation_id = p_generation_id
           AND stored.source_race_id = requested ->> 'sourceRaceId'
         WHERE stored.source_race_id IS NULL
           OR stored.observed_at <> (requested ->> 'observedAt')::timestamptz
           OR stored.raw_evidence_sha256 <> requested ->> 'rawEvidenceSha256'
           OR stored.canonical <> requested -> 'canonical'
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab published current-race replay conflict';
    END IF;
    RETURN 'published';
  END IF;

  v_status := dna.stage_dna_open_lab_materialized_candidate(
    p_owner_id, p_generation_id, p_observed_at, p_recorded_at,
    p_families, p_owned_cores
  );
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'DNA Open Lab current-race generation was not staged';
  END IF;
  DELETE FROM dna.dna_open_lab_race_fill_snapshot
  WHERE owner_id = p_owner_id AND generation_id = p_generation_id;
  DELETE FROM dna.dna_open_lab_active_race_snapshot
  WHERE owner_id = p_owner_id AND generation_id = p_generation_id;
  INSERT INTO dna.dna_open_lab_active_race_snapshot (
    owner_id, generation_id, source_race_id, observed_at,
    raw_evidence_sha256, canonical
  ) SELECT p_owner_id, p_generation_id, entry ->> 'sourceRaceId',
    (entry ->> 'observedAt')::timestamptz,
    (entry ->> 'rawEvidenceSha256')::character(64), entry -> 'canonical'
  FROM jsonb_array_elements(p_active_races) entry;
  INSERT INTO dna.dna_open_lab_race_fill_snapshot (
    owner_id, generation_id, source_race_id, observed_at,
    raw_evidence_sha256, canonical
  ) SELECT p_owner_id, p_generation_id, entry ->> 'sourceRaceId',
    (entry ->> 'observedAt')::timestamptz,
    (entry ->> 'rawEvidenceSha256')::character(64), entry -> 'canonical'
  FROM jsonb_array_elements(p_race_fills) entry;
  UPDATE dna.dna_open_lab_sync_generation
  SET materialization_contract_version = 2
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
     AND NEW.materialization_contract_version = 2 THEN
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
  RETURN NEW;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_serving_active_races(p_owner_id uuid)
RETURNS TABLE (
  generation_id uuid, source_race_id text, observed_at timestamptz,
  raw_evidence_sha256 character(64), canonical jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab active-race read denied';
  END IF;
  RETURN QUERY SELECT snapshot.generation_id, snapshot.source_race_id,
    snapshot.observed_at, snapshot.raw_evidence_sha256, snapshot.canonical
  FROM dna.dna_open_lab_sync_state state
  JOIN dna.dna_open_lab_active_race_snapshot snapshot
    ON snapshot.owner_id = state.owner_id
    AND snapshot.generation_id = state.serving_generation_id
  WHERE state.owner_id = p_owner_id ORDER BY snapshot.source_race_id;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_serving_race_fills(p_owner_id uuid)
RETURNS TABLE (
  generation_id uuid, source_race_id text, observed_at timestamptz,
  raw_evidence_sha256 character(64), canonical jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab race-fill read denied';
  END IF;
  RETURN QUERY SELECT snapshot.generation_id, snapshot.source_race_id,
    snapshot.observed_at, snapshot.raw_evidence_sha256, snapshot.canonical
  FROM dna.dna_open_lab_sync_state state
  JOIN dna.dna_open_lab_race_fill_snapshot snapshot
    ON snapshot.owner_id = state.owner_id
    AND snapshot.generation_id = state.serving_generation_id
  WHERE state.owner_id = p_owner_id ORDER BY snapshot.source_race_id;
END
$function$;

REVOKE ALL ON TABLE dna.dna_open_lab_active_race_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_race_fill_snapshot FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.stage_dna_open_lab_current_race_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_serving_active_races(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_serving_race_fills(uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION dna.stage_dna_open_lab_materialized_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb
) FROM dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.stage_dna_open_lab_current_race_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_serving_active_races(uuid)
TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_serving_race_fills(uuid)
TO dna_app_runtime;

COMMIT;
