DO $activation_evidence_compaction_removal$
BEGIN
  IF to_regprocedure(
    'dna.compact_import_activation_dataset_evidence(uuid,uuid,uuid,timestamptz,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'activation evidence compaction function was not removed';
  END IF;
END
$activation_evidence_compaction_removal$;
