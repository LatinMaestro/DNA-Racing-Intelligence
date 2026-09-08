DO $removal$
BEGIN
  IF to_regprocedure('dna.read_dna_open_lab_combined_serving_sync_state(uuid)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_combined_serving_active_races(uuid)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_combined_serving_race_fills(uuid)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_combined_serving_supplemental_cores(uuid)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_combined_serving_current_state_evidence_index(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'combined serving read functions remain after reversal';
  END IF;
END
$removal$;
