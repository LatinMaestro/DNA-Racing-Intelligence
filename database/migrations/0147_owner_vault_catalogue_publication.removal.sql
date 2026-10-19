DO $removal$
BEGIN
  IF to_regprocedure(
    'dna.read_owner_vault_catalogue_publication(uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Vault catalogue publication read removal failed';
  END IF;
END
$removal$;
