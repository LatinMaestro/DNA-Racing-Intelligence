DO $removal$
BEGIN
  IF to_regclass('dna.vault_performance_summary_source_state') IS NOT NULL
    OR to_regprocedure('dna.invalidate_vault_performance_summary_source()') IS NOT NULL
    OR to_regprocedure('dna.read_vault_performance_canonical_source(uuid)') IS NOT NULL
    OR to_regprocedure('dna.claim_vault_performance_source_identity(uuid,bigint,text)') IS NOT NULL
    OR to_regprocedure('dna.read_vault_performance_source_identity(uuid)') IS NOT NULL
    OR to_regprocedure('dna.publish_vault_performance_summary_snapshot(uuid,text,timestamptz,text,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Vault Performance publication migration was not removed';
  END IF;
END
$removal$;
