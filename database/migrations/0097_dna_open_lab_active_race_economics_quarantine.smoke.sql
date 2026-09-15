BEGIN;

SELECT dna.validate_dna_open_lab_active_race_canonical(
  'race-101',
  '{"sourceType":"active_race_snapshot","sourceRaceId":"race-101","status":"open","displayName":"Synthetic Race","mode":"bike","format":null,"raceClassSourceValue":null,"fixedFeesEvidenceStatus":"unsupported_source_value","entryFeeEvidenceStatus":"unsupported_source_value","paymentAssetEvidenceStatus":"unsupported_source_value","startAt":null,"endAt":null}'::jsonb
);

SELECT dna.validate_dna_open_lab_active_race_canonical(
  'race-102',
  '{"sourceType":"active_race_snapshot","sourceRaceId":"race-102","status":"open","displayName":"Synthetic Race","mode":"bike","format":null,"raceClassSourceValue":null,"fixedFeesByAsset":{"DEZ":0.25},"entryFeeUsd":2.5,"paymentAsset":"DEZ","startAt":null,"endAt":null}'::jsonb
);

DO $guards$
BEGIN
  BEGIN
    PERFORM dna.validate_dna_open_lab_active_race_canonical(
      'race-103',
      '{"sourceType":"active_race_snapshot","sourceRaceId":"race-103","status":"open","displayName":"Synthetic Race","mode":"bike","format":null,"raceClassSourceValue":null,"fixedFeesByAsset":{},"fixedFeesEvidenceStatus":"unsupported_source_value","entryFeeUsd":0,"paymentAsset":"DEZ","startAt":null,"endAt":null}'::jsonb
    );
    RAISE EXCEPTION 'mixed fixed-fee value and quarantine status were accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'mixed fixed-fee value and quarantine status were accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.validate_dna_open_lab_active_race_canonical(
      'race-104',
      '{"sourceType":"active_race_snapshot","sourceRaceId":"race-104","status":"open","displayName":"Synthetic Race","mode":"bike","format":null,"raceClassSourceValue":null,"fixedFeesByAsset":{},"entryFeeEvidenceStatus":"unknown","paymentAsset":"DEZ","startAt":null,"endAt":null}'::jsonb
    );
    RAISE EXCEPTION 'unknown entry-fee evidence status was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unknown entry-fee evidence status was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.validate_dna_open_lab_active_race_canonical(
      'race-105',
      '{"sourceType":"active_race_snapshot","sourceRaceId":"race-105","status":"open","displayName":"Synthetic Race","mode":"bike","format":null,"raceClassSourceValue":null,"fixedFeesByAsset":{"DEZ":-1},"entryFeeUsd":0,"paymentAsset":"DEZ","startAt":null,"endAt":null}'::jsonb
    );
    RAISE EXCEPTION 'negative fixed fee was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'negative fixed fee was accepted' THEN RAISE; END IF;
  END;
END
$guards$;

DO $installed$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure(
       'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)'
     ) IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_functiondef(
    'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)'::regprocedure
  ) INTO v_definition;
  IF position('PERFORM dna.validate_dna_open_lab_active_race_canonical(' IN v_definition) = 0
     OR position('IF v_key_count <> 12 OR NOT (' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'active-race quarantine validator is not installed';
  END IF;
END
$installed$;

ROLLBACK;
