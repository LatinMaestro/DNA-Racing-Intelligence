DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.read_dna_open_lab_p5_recovery_fingerprints(uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'DNA Open Lab P5 recovery fingerprint objects still exist';
  END IF;
END
$removal$;
