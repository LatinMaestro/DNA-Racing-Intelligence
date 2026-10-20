BEGIN;

CREATE FUNCTION dna.list_tournament_vault_core_state(p_owner_id uuid)
RETURNS TABLE (
  source_core_id text,
  core_class text,
  element text,
  f_number integer,
  core_details_active boolean,
  me_eligible boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Tournament Vault Core state read denied';
  END IF;

  RETURN QUERY
  SELECT
    core.source_core_id,
    core.core_class,
    core.element,
    core.f_number,
    EXISTS (
      SELECT 1
      FROM dna.active_core_details active_core
      WHERE active_core.owner_id = core.owner_id
        AND active_core.id = core.id
    ) AS core_details_active,
    vault.me_eligible
  FROM dna.owner_vault_core vault
  JOIN dna.core core
    ON core.owner_id = vault.owner_id
    AND core.id = vault.core_id
  WHERE vault.owner_id = p_owner_id
    AND vault.in_my_vault
  ORDER BY core.source_core_id;
END
$function$;

REVOKE ALL ON FUNCTION dna.list_tournament_vault_core_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_tournament_vault_core_state(uuid)
  TO dna_app_runtime;

COMMIT;
