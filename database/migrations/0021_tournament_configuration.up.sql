BEGIN;

CREATE TABLE dna.tournament_configuration (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  tournament_label text NOT NULL,
  bracket_id text NOT NULL,
  split_label text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('bike','car','horse')),
  eligible_distances_metres integer[] NOT NULL,
  discovery_relevance text NOT NULL CHECK (discovery_relevance IN ('eligible','priority')),
  qualification_metric_label text NOT NULL,
  configuration_version text NOT NULL,
  candidate_snapshot_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, tournament_id, bracket_id),
  CHECK (cardinality(eligible_distances_metres) > 0),
  CHECK (0 < ALL (eligible_distances_metres))
);

ALTER TABLE dna.tournament_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.tournament_configuration FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.tournament_configuration
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.list_tournament_configurations(p_owner_id uuid)
RETURNS TABLE (
  tournament_id text,
  tournament_label text,
  bracket_id text,
  split_label text,
  mode text,
  eligible_distances_metres integer[],
  discovery_relevance text,
  qualification_metric_label text,
  configuration_version text,
  candidate_snapshot_version text,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped Tournament configuration read denied';
  END IF;
  RETURN QUERY
  SELECT c.tournament_id, c.tournament_label, c.bracket_id, c.split_label,
    c.mode, c.eligible_distances_metres, c.discovery_relevance,
    c.qualification_metric_label, c.configuration_version,
    c.candidate_snapshot_version, c.updated_at
  FROM dna.tournament_configuration c
  WHERE c.owner_id = p_owner_id
  ORDER BY c.tournament_label, c.split_label, c.bracket_id;
END
$function$;

REVOKE ALL ON TABLE dna.tournament_configuration FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_tournament_configurations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_tournament_configurations(uuid) TO dna_app_runtime;

COMMIT;
