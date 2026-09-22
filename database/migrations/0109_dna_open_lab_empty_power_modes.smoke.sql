BEGIN;

DO $empty_power_modes$
DECLARE
  v_empty jsonb := '{
    "sourceType":"core_power_snapshot",
    "sourceCoreId":"101",
    "byMode":{},
    "aggregateStatsSourceValue":{"provider":"aggregate-only"}
  }'::jsonb;
  v_partial jsonb := jsonb_set(
    v_empty,
    '{byMode,bike}',
    '{
      "powerSourceValue":80,
      "adjustedOddsSourceValue":null,
      "varianceSourceValue":4,
      "raceCount":7
    }'::jsonb
  );
  v_full jsonb;
BEGIN
  PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
    'power',
    '101',
    v_empty
  );
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
      jsonb_set(
        v_empty,
        '{byMode,plane}',
        v_partial -> 'byMode' -> 'bike'
      )
    );
    RAISE EXCEPTION 'unknown empty power mode was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unknown empty power mode was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'power',
      '101',
      jsonb_set(v_partial, '{byMode,bike,raceCount}', '-1'::jsonb)
    );
    RAISE EXCEPTION 'invalid empty power-mode evidence was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid empty power-mode evidence was accepted' THEN RAISE; END IF;
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
$empty_power_modes$;

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
    RAISE EXCEPTION 'empty power-mode validator is executable by PUBLIC';
  END IF;
END
$permissions$;

ROLLBACK;
