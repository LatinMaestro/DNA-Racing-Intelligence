BEGIN;

DROP FUNCTION dna.validate_dna_open_lab_supplemental_core_canonical(
  text,
  text,
  jsonb
);

ALTER FUNCTION dna.validate_dna_open_lab_supplemental_core_canonical_complete_power_modes(
  text,
  text,
  jsonb
) RENAME TO validate_dna_open_lab_supplemental_core_canonical;

COMMIT;
