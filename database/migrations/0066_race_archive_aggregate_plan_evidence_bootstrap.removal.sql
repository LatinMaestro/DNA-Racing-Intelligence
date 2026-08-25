DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.bootstrap_race_archive_aggregate_evidence_receipts(uuid,uuid,uuid,character)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Race archive aggregate plan evidence bootstrap function still exists after reversal';
  END IF;
END
$removal$;
