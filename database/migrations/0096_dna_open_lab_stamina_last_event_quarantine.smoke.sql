BEGIN;

SELECT dna.validate_dna_open_lab_supplemental_core_canonical(
  'stamina',
  '101',
  '{"sourceType":"core_stamina_snapshot","sourceCoreId":"101","current":8,"maximum":10,"nextRefillAt":null,"lastEventAt":null,"lastEventEvidenceStatus":"unsupported_source_value","special":null}'::jsonb
);

DO $guards$
BEGIN
  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'stamina',
      '101',
      '{"sourceType":"core_stamina_snapshot","sourceCoreId":"101","current":8,"maximum":10,"nextRefillAt":null,"lastEventAt":"2026-09-14T00:00:00Z","lastEventEvidenceStatus":"unsupported_source_value","special":null}'::jsonb
    );
    RAISE EXCEPTION 'stamina quarantine accepted an invented last-event time';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'stamina quarantine accepted an invented last-event time' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'stamina',
      '101',
      '{"sourceType":"core_stamina_snapshot","sourceCoreId":"101","current":8,"maximum":10,"nextRefillAt":null,"lastEventAt":null,"lastEventEvidenceStatus":"unknown","special":null}'::jsonb
    );
    RAISE EXCEPTION 'unknown stamina evidence status was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unknown stamina evidence status was accepted' THEN RAISE; END IF;
  END;
END
$guards$;

ROLLBACK;
