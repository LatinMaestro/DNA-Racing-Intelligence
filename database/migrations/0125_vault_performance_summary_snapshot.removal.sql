DO $removal$
BEGIN
  IF to_regclass('dna.vault_performance_summary_snapshot') IS NOT NULL
    OR to_regprocedure('dna.read_vault_performance_summary_snapshot(uuid,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Vault Performance snapshot migration was not removed';
  END IF;
END
$removal$;
