BEGIN;

DO $removal$
BEGIN
  BEGIN
    PERFORM dna.validate_dna_open_lab_supplemental_core_canonical(
      'stamina',
      '101',
      '{"sourceType":"core_stamina_snapshot","sourceCoreId":"101","current":8,"maximum":10,"nextRefillAt":null,"lastEventAt":null,"lastEventEvidenceStatus":"unsupported_source_value","special":null}'::jsonb
    );
    RAISE EXCEPTION 'stamina last-event quarantine compatibility remains installed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'stamina last-event quarantine compatibility remains installed' THEN RAISE; END IF;
  END;
END
$removal$;

ROLLBACK;
