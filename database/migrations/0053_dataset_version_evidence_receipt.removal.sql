DO $dataset_version_evidence_receipt_removal$
BEGIN
  IF to_regclass('dna.dataset_version_evidence_receipt') IS NOT NULL THEN
    RAISE EXCEPTION 'dataset version evidence receipt table was not removed';
  END IF;
  IF to_regprocedure(
    'dna.seal_dataset_version_evidence(uuid,uuid,timestamptz)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'dataset version evidence sealing function was not removed';
  END IF;
END
$dataset_version_evidence_receipt_removal$;
