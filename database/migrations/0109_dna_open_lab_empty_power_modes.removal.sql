DO $removal$
DECLARE
  v_empty jsonb := '{
    "sourceType":"core_power_snapshot",
    "sourceCoreId":"101",
    "byMode":{},
    "aggregateStatsSourceValue":{}
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
BEGIN
  PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
    'power',
    '101',
    v_partial
  );

  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'power',
      '101',
      v_empty
    );
    RAISE EXCEPTION 'empty power-mode migration did not reverse';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'empty power-mode migration did not reverse' THEN RAISE; END IF;
  END;
END
$removal$;
