BEGIN;

CREATE FUNCTION dna.search_owner_vault_catalogue(
  p_owner_id uuid,
  p_query text,
  p_element text,
  p_core_class text,
  p_sex text,
  p_f_number integer,
  p_scope text,
  p_limit integer
)
RETURNS TABLE (
  source_core_id text,
  display_name text,
  core_class text,
  element text,
  f_number integer,
  sex text,
  in_my_vault boolean,
  me_eligible boolean,
  version bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Vault catalogue search denied';
  END IF;

  IF p_query IS NOT NULL AND (
    p_query <> btrim(p_query)
    OR p_query = ''
    OR length(p_query) > 128
  ) THEN
    RAISE EXCEPTION 'Vault catalogue query is invalid';
  END IF;

  IF p_element IS NOT NULL AND p_element NOT IN (
    'Metal',
    'Fire',
    'Earth',
    'Water'
  ) THEN
    RAISE EXCEPTION 'Vault catalogue element filter is invalid';
  END IF;

  IF p_core_class IS NOT NULL AND p_core_class NOT IN (
    'Genesis',
    'Morphed',
    'Freak',
    'X-Class'
  ) THEN
    RAISE EXCEPTION 'Vault catalogue class filter is invalid';
  END IF;

  IF p_sex IS NOT NULL AND p_sex NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'Vault catalogue sex filter is invalid';
  END IF;

  IF p_f_number IS NOT NULL AND p_f_number <= 0 THEN
    RAISE EXCEPTION 'Vault catalogue F-number filter is invalid';
  END IF;

  IF p_scope IS NULL OR p_scope NOT IN ('vault', 'catalogue') THEN
    RAISE EXCEPTION 'Vault catalogue scope is invalid';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Vault catalogue result limit is invalid';
  END IF;

  RETURN QUERY
  SELECT
    core.source_core_id,
    core.display_name,
    core.core_class,
    core.element,
    core.f_number,
    core.sex,
    COALESCE(vault.in_my_vault, false),
    COALESCE(vault.me_eligible, false),
    COALESCE(vault.version, 0),
    vault.updated_at
  FROM dna.active_core_details core
  LEFT JOIN dna.owner_vault_core vault
    ON vault.owner_id = core.owner_id
    AND vault.core_id = core.id
  WHERE
    core.owner_id = p_owner_id
    AND (
      p_query IS NULL
      OR position(lower(p_query) in lower(core.source_core_id)) > 0
      OR position(lower(p_query) in lower(core.display_name)) > 0
    )
    AND (p_element IS NULL OR core.element = p_element)
    AND (p_core_class IS NULL OR core.core_class = p_core_class)
    AND (p_sex IS NULL OR core.sex = p_sex)
    AND (p_f_number IS NULL OR core.f_number = p_f_number)
    AND (p_scope <> 'vault' OR COALESCE(vault.in_my_vault, false))
  ORDER BY
    CASE
      WHEN p_query IS NOT NULL AND core.source_core_id = p_query THEN 0
      WHEN
        p_query IS NOT NULL
        AND lower(core.display_name) = lower(p_query)
      THEN 1
      ELSE 2
    END,
    lower(core.display_name) NULLS LAST,
    core.source_core_id
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON FUNCTION dna.search_owner_vault_catalogue(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  text,
  integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.search_owner_vault_catalogue(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  text,
  integer
) TO dna_app_runtime;

COMMIT;
