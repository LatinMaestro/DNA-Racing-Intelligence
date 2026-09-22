BEGIN;

DO $partial_power_modes$
DECLARE
  v_partial jsonb := '{
    "sourceType":"core_power_snapshot",
    "sourceCoreId":"101",
    "byMode":{
      "bike":{
        "powerSourceValue":80,
        "adjustedOddsSourceValue":null,
        "varianceSourceValue":4,
        "raceCount":7
      }
    },
    "aggregateStatsSourceValue":{}
  }'::jsonb;
  v_full jsonb;
BEGIN
  PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
    'power',
    '101',
    v_partial
  );

  v_full := jsonb_set(
    jsonb_set(
      v_partial,
      '{byMode,car}',
      '{
        "powerSourceValue":null,
        "adjustedOddsSourceValue":null,
        "varianceSourceValue":null,
        "raceCount":0
      }'::jsonb
    ),
    '{byMode,horse}',
    '{
      "powerSourceValue":null,
      "adjustedOddsSourceValue":null,
      "varianceSourceValue":null,
      "raceCount":0
    }'::jsonb
  );
  PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
    'power',
    '101',
    v_full
  );

  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'power',
      '101',
      jsonb_set(v_partial, '{byMode}', '{}'::jsonb)
    );
    RAISE EXCEPTION 'empty partial power-mode evidence was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'empty partial power-mode evidence was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'power',
      '101',
      jsonb_set(
        v_partial,
        '{byMode,plane}',
        v_partial -> 'byMode' -> 'bike'
      )
    );
    RAISE EXCEPTION 'unknown partial power mode was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unknown partial power mode was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'power',
      '101',
      jsonb_set(v_partial, '{byMode,bike,raceCount}', '-1'::jsonb)
    );
    RAISE EXCEPTION 'invalid partial power-mode evidence was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid partial power-mode evidence was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'owners',
      '101',
      '{"sourceType":"core_owner_snapshot","sourceCoreId":"101"}'::jsonb
    );
    RAISE EXCEPTION 'delegated supplemental validation was weakened';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'delegated supplemental validation was weakened' THEN RAISE; END IF;
  END;
END
$partial_power_modes$;

DO $permissions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc procedure_record
    CROSS JOIN LATERAL aclexplode(COALESCE(
      procedure_record.proacl,
      acldefault('f', procedure_record.proowner)
    )) privilege_record
    WHERE procedure_record.oid =
      'dna.validate_dna_open_lab_supplemental_core_canonical(text,text,jsonb)'::regprocedure
      AND privilege_record.grantee = 0
      AND privilege_record.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'partial power-mode validator is executable by PUBLIC';
  END IF;
END
$permissions$;

ROLLBACK;
