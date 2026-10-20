DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.list_tournament_vault_core_state(uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Tournament Vault Core state read removal failed';
  END IF;
END
$removal$;
