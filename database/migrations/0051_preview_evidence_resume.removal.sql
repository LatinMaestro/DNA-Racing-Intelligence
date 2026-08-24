DO $check$
BEGIN
  IF to_regclass('dna.import_preview_evidence_receipt') IS NOT NULL THEN
    RAISE EXCEPTION 'Preview evidence receipt table still exists';
  END IF;
END
$check$;
