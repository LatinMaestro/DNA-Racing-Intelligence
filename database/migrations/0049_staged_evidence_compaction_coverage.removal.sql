DO $staged_evidence_compaction_removal$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.compact_accepted_dataset_evidence(uuid,uuid,timestamp with time zone)'::regprocedure
  ) INTO v_definition;
  IF v_definition IS NULL
     OR position('normalized_partition' IN v_definition) = 0
     OR position('staged_rows' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'staged evidence compaction compatibility was not removed';
  END IF;
END
$staged_evidence_compaction_removal$;
