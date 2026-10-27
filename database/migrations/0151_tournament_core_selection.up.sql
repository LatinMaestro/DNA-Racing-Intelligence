BEGIN;

CREATE TABLE dna.tournament_core_selection (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  bracket_id text NOT NULL,
  configuration_version text NOT NULL,
  candidate_snapshot_version text NOT NULL,
  core_ids text[] NOT NULL,
  updated_at timestamptz NOT NULL CHECK (isfinite(updated_at)),
  PRIMARY KEY (owner_id, tournament_id, bracket_id),
  FOREIGN KEY (owner_id, tournament_id, bracket_id)
    REFERENCES dna.tournament_configuration(owner_id, tournament_id, bracket_id)
    ON DELETE CASCADE,
  CHECK (cardinality(core_ids) BETWEEN 0 AND 500),
  CHECK (array_position(core_ids, NULL) IS NULL)
);

ALTER TABLE dna.tournament_core_selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.tournament_core_selection FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.tournament_core_selection
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.replace_tournament_core_selection(
  p_owner_id uuid,
  p_tournament_id text,
  p_bracket_id text,
  p_configuration_version text,
  p_candidate_snapshot_version text,
  p_core_ids text[],
  p_updated_at timestamptz
)
RETURNS TABLE (
  tournament_id text,
  bracket_id text,
  configuration_version text,
  candidate_snapshot_version text,
  core_ids text[],
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_configuration dna.tournament_configuration%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Tournament Core selection write denied';
  END IF;
  IF p_tournament_id IS NULL OR btrim(p_tournament_id) = ''
    OR p_bracket_id IS NULL OR btrim(p_bracket_id) = ''
    OR p_configuration_version IS NULL OR btrim(p_configuration_version) = ''
    OR p_candidate_snapshot_version IS NULL
    OR btrim(p_candidate_snapshot_version) = ''
    OR p_candidate_snapshot_version = 'snapshot-unbound'
    OR p_core_ids IS NULL
    OR cardinality(p_core_ids) > 500
    OR p_updated_at IS NULL OR NOT isfinite(p_updated_at)
    OR p_updated_at > clock_timestamp()
    OR EXISTS (
      SELECT 1 FROM unnest(p_core_ids) core_id
      WHERE core_id IS NULL OR btrim(core_id) = ''
        OR octet_length(core_id) > 128 OR core_id ~ '[[:cntrl:]]'
    )
    OR cardinality(p_core_ids) <>
      (SELECT count(DISTINCT core_id) FROM unnest(p_core_ids) core_id)
  THEN
    RAISE EXCEPTION 'Tournament Core selection is invalid';
  END IF;

  SELECT configuration.* INTO v_configuration
  FROM dna.tournament_configuration configuration
  WHERE configuration.owner_id = p_owner_id
    AND configuration.tournament_id = p_tournament_id
    AND configuration.bracket_id = p_bracket_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_configuration.configuration_version IS DISTINCT FROM
      p_configuration_version
    OR v_configuration.candidate_snapshot_version IS DISTINCT FROM
      p_candidate_snapshot_version
  THEN
    RAISE EXCEPTION 'Tournament Core selection authority changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_core_ids) selected(core_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM dna.owner_vault_core vault
      JOIN dna.core core
        ON core.owner_id = vault.owner_id AND core.id = vault.core_id
      WHERE vault.owner_id = p_owner_id
        AND vault.in_my_vault
        AND core.source_core_id = selected.core_id
    )
  ) THEN
    RAISE EXCEPTION 'Tournament Core selection contains a non-Vault Core';
  END IF;

  INSERT INTO dna.tournament_core_selection (
    owner_id, tournament_id, bracket_id, configuration_version,
    candidate_snapshot_version, core_ids, updated_at
  ) VALUES (
    p_owner_id, p_tournament_id, p_bracket_id, p_configuration_version,
    p_candidate_snapshot_version, p_core_ids, p_updated_at
  )
  ON CONFLICT (owner_id, tournament_id, bracket_id) DO UPDATE SET
    configuration_version = EXCLUDED.configuration_version,
    candidate_snapshot_version = EXCLUDED.candidate_snapshot_version,
    core_ids = EXCLUDED.core_ids,
    updated_at = EXCLUDED.updated_at;

  RETURN QUERY
  SELECT selection.tournament_id, selection.bracket_id,
    selection.configuration_version, selection.candidate_snapshot_version,
    selection.core_ids, selection.updated_at
  FROM dna.tournament_core_selection selection
  WHERE selection.owner_id = p_owner_id
    AND selection.tournament_id = p_tournament_id
    AND selection.bracket_id = p_bracket_id;
END
$function$;

CREATE FUNCTION dna.read_tournament_core_selection(
  p_owner_id uuid,
  p_tournament_id text,
  p_bracket_id text
)
RETURNS TABLE (
  tournament_id text,
  bracket_id text,
  configuration_version text,
  candidate_snapshot_version text,
  core_ids text[],
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Tournament Core selection read denied';
  END IF;
  RETURN QUERY
  SELECT selection.tournament_id, selection.bracket_id,
    selection.configuration_version, selection.candidate_snapshot_version,
    selection.core_ids, selection.updated_at
  FROM dna.tournament_core_selection selection
  JOIN dna.tournament_configuration configuration
    ON configuration.owner_id = selection.owner_id
   AND configuration.tournament_id = selection.tournament_id
   AND configuration.bracket_id = selection.bracket_id
   AND configuration.configuration_version = selection.configuration_version
   AND configuration.candidate_snapshot_version =
     selection.candidate_snapshot_version
  WHERE selection.owner_id = p_owner_id
    AND selection.tournament_id = p_tournament_id
    AND selection.bracket_id = p_bracket_id;
END
$function$;

REVOKE ALL ON TABLE dna.tournament_core_selection
  FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.replace_tournament_core_selection(
  uuid,text,text,text,text,text[],timestamptz),
  dna.read_tournament_core_selection(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.replace_tournament_core_selection(
  uuid,text,text,text,text,text[],timestamptz),
  dna.read_tournament_core_selection(uuid,text,text) TO dna_app_runtime;

COMMIT;
