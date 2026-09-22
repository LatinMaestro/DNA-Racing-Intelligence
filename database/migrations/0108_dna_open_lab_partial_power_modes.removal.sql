DO $removal$
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
BEGIN
  IF to_regprocedure(
    'dna.validate_dna_open_lab_supplemental_core_canonical_complete_power_modes(text,text,jsonb)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'partial power-mode helper still exists';
  END IF;

  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'power',
      '101',
      v_partial
    );
    RAISE EXCEPTION 'partial power-mode migration did not reverse';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'partial power-mode migration did not reverse' THEN RAISE; END IF;
  END;
END
$removal$;
