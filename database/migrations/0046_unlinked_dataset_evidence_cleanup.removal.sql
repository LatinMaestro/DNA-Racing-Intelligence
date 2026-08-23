DO $dataset_evidence_cleanup_removal$
BEGIN
  IF to_regprocedure(
    'dna.cleanup_unlinked_dataset_evidence_batch(uuid,uuid,character)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'unlinked dataset evidence cleanup boundary was not removed';
  END IF;
END
$dataset_evidence_cleanup_removal$;
