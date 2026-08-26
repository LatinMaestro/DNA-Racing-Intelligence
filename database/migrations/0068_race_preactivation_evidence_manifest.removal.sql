DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.list_race_preactivation_evidence_manifest(uuid,uuid,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Race preactivation evidence manifest function still exists';
  END IF;
END
$removal$;
