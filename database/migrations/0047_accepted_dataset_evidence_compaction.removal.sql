DO $accepted_evidence_compaction_removal$
BEGIN
  IF to_regprocedure(
    'dna.compact_accepted_dataset_evidence(uuid,uuid,timestamptz)'
  ) IS NOT NULL OR to_regclass(
    'dna.dataset_evidence_compaction_receipt'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'accepted evidence compaction boundary was not removed';
  END IF;
END
$accepted_evidence_compaction_removal$;
