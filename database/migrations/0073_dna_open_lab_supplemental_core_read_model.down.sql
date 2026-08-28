BEGIN;

GRANT EXECUTE ON FUNCTION dna.stage_dna_open_lab_current_race_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb
) TO dna_app_runtime;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_serving_supplemental_cores(uuid);
DROP FUNCTION IF EXISTS dna.stage_dna_open_lab_supplemental_core_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb
);
DROP FUNCTION IF EXISTS dna.validate_dna_open_lab_supplemental_core_canonical(
  text, text, jsonb
);

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

UPDATE dna.dna_open_lab_sync_generation
SET materialization_contract_version = 2
WHERE materialization_contract_version = 3;

DROP TABLE IF EXISTS dna.dna_open_lab_core_supplemental_snapshot;

ALTER TABLE dna.dna_open_lab_sync_generation
  DROP CONSTRAINT dna_open_lab_sync_generation_materialization_version_check;
ALTER TABLE dna.dna_open_lab_sync_generation
  ADD CONSTRAINT dna_open_lab_sync_generation_materialization_version_check
  CHECK (materialization_contract_version BETWEEN 0 AND 2);

COMMIT;
