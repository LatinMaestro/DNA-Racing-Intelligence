DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_current_state_evidence_index') IS NOT NULL
     OR to_regprocedure('dna.validate_dna_open_lab_current_state_evidence_index(uuid,jsonb)') IS NOT NULL
     OR to_regprocedure('dna.save_dna_open_lab_current_state_evidence_index(uuid,uuid,jsonb,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.publish_dna_open_lab_indexed_sync_candidate(uuid,uuid,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_serving_current_state_evidence_index(uuid)') IS NOT NULL
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.publish_dna_open_lab_sync_candidate(uuid,uuid,timestamp with time zone)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'DNA Open Lab current-state evidence index objects still exist';
  END IF;
END
$removal$;
