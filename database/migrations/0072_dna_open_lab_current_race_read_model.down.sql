BEGIN;

GRANT EXECUTE ON FUNCTION dna.stage_dna_open_lab_materialized_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb
) TO dna_app_runtime;

DROP FUNCTION IF EXISTS dna.read_dna_open_lab_serving_race_fills(uuid);
DROP FUNCTION IF EXISTS dna.read_dna_open_lab_serving_active_races(uuid);
DROP FUNCTION IF EXISTS dna.stage_dna_open_lab_current_race_candidate(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb
);

CREATE OR REPLACE FUNCTION dna.enforce_dna_open_lab_materialized_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_expected_core_count bigint;
  v_actual_core_count bigint;
BEGIN
  IF OLD.status = 'staged' AND NEW.status = 'published'
     AND NEW.materialization_contract_version = 1 THEN
    SELECT family.item_count INTO v_expected_core_count
    FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id
      AND family.generation_id = NEW.id
      AND family.family = 'cores'
      AND family.status = 'complete';
    SELECT count(*) INTO v_actual_core_count
    FROM dna.dna_open_lab_owned_core_snapshot core
    WHERE core.owner_id = NEW.owner_id AND core.generation_id = NEW.id;
    IF v_expected_core_count IS NULL
       OR v_expected_core_count <> v_actual_core_count THEN
      RAISE EXCEPTION 'DNA Open Lab owned Core materialization is incomplete';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

UPDATE dna.dna_open_lab_sync_generation
SET materialization_contract_version = 1
WHERE materialization_contract_version = 2;

DROP TABLE IF EXISTS dna.dna_open_lab_race_fill_snapshot;
DROP TABLE IF EXISTS dna.dna_open_lab_active_race_snapshot;

ALTER TABLE dna.dna_open_lab_sync_generation
  DROP CONSTRAINT dna_open_lab_sync_generation_materialization_contract_version_c;
ALTER TABLE dna.dna_open_lab_sync_generation
  ADD CHECK (materialization_contract_version BETWEEN 0 AND 1);

COMMIT;
