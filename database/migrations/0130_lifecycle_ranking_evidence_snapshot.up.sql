BEGIN;

-- Compact accepted lifecycle evidence only. This read boundary never derives
-- a ranking from raw history during page composition and exposes no writes.
CREATE TABLE dna.lifecycle_ranking_evidence_snapshot (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  ranking_id text NOT NULL CHECK (btrim(ranking_id) <> ''),
  configuration_version text NOT NULL CHECK (btrim(configuration_version) <> ''),
  candidate_snapshot_version text NOT NULL CHECK (btrim(candidate_snapshot_version) <> ''),
  racing_snapshot_version text NOT NULL CHECK (btrim(racing_snapshot_version) <> ''),
  discovery_snapshot_version text NOT NULL CHECK (btrim(discovery_snapshot_version) <> ''),
  maiden_snapshot_version text NOT NULL CHECK (btrim(maiden_snapshot_version) <> ''),
  breeding_snapshot_version text NOT NULL CHECK (btrim(breeding_snapshot_version) <> ''),
  lineage_snapshot_version text NOT NULL CHECK (btrim(lineage_snapshot_version) <> ''),
  market_snapshot_version text NOT NULL CHECK (btrim(market_snapshot_version) <> ''),
  data_current_through timestamptz NOT NULL CHECK (isfinite(data_current_through)),
  latest_accepted_import_at timestamptz NOT NULL CHECK (isfinite(latest_accepted_import_at)),
  evaluated_at timestamptz NOT NULL CHECK (isfinite(evaluated_at)),
  published_at timestamptz NOT NULL CHECK (isfinite(published_at)),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_json text NOT NULL CHECK (octet_length(snapshot_json) BETWEEN 1 AND 524288),
  CHECK (data_current_through <= latest_accepted_import_at),
  CHECK (latest_accepted_import_at <= evaluated_at),
  CHECK (evaluated_at <= published_at),
  CHECK (snapshot_sha256 = encode(sha256(convert_to(snapshot_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(snapshot_json::jsonb) IS NOT DISTINCT FROM 'object'),
  CHECK ((snapshot_json::jsonb -> 'version') IS NOT DISTINCT FROM '1'::jsonb),
  CHECK ((snapshot_json::jsonb ->> 'databaseOwnerId') IS NOT DISTINCT FROM owner_id::text),
  CHECK ((snapshot_json::jsonb ->> 'publishedAt')::timestamptz IS NOT DISTINCT FROM published_at),
  CHECK ((snapshot_json::jsonb ->> 'latestAcceptedImportAt')::timestamptz IS NOT DISTINCT FROM latest_accepted_import_at),
  CHECK (jsonb_typeof(snapshot_json::jsonb -> 'ranking') IS NOT DISTINCT FROM 'object'),
  CHECK ((snapshot_json::jsonb #>> '{ranking,rankingId}') IS NOT DISTINCT FROM ranking_id),
  CHECK ((snapshot_json::jsonb #>> '{ranking,configurationVersion}') IS NOT DISTINCT FROM configuration_version),
  CHECK ((snapshot_json::jsonb #>> '{ranking,candidateSnapshotVersion}') IS NOT DISTINCT FROM candidate_snapshot_version),
  CHECK ((snapshot_json::jsonb #>> '{ranking,racingSnapshotVersion}') IS NOT DISTINCT FROM racing_snapshot_version),
  CHECK ((snapshot_json::jsonb #>> '{ranking,discoverySnapshotVersion}') IS NOT DISTINCT FROM discovery_snapshot_version),
  CHECK ((snapshot_json::jsonb #>> '{ranking,maidenSnapshotVersion}') IS NOT DISTINCT FROM maiden_snapshot_version),
  CHECK ((snapshot_json::jsonb #>> '{ranking,breedingSnapshotVersion}') IS NOT DISTINCT FROM breeding_snapshot_version),
  CHECK ((snapshot_json::jsonb #>> '{ranking,lineageSnapshotVersion}') IS NOT DISTINCT FROM lineage_snapshot_version),
  CHECK ((snapshot_json::jsonb #>> '{ranking,marketSnapshotVersion}') IS NOT DISTINCT FROM market_snapshot_version),
  CHECK ((snapshot_json::jsonb #>> '{ranking,dataCurrentThrough}')::timestamptz IS NOT DISTINCT FROM data_current_through),
  CHECK ((snapshot_json::jsonb #>> '{ranking,lastImported}')::timestamptz IS NOT DISTINCT FROM latest_accepted_import_at),
  CHECK ((snapshot_json::jsonb #>> '{ranking,evaluatedAt}')::timestamptz IS NOT DISTINCT FROM evaluated_at)
);

ALTER TABLE dna.lifecycle_ranking_evidence_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.lifecycle_ranking_evidence_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.lifecycle_ranking_evidence_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_lifecycle_ranking_evidence_snapshot(
  p_owner_id uuid
)
RETURNS TABLE (
  ranking_id text,
  configuration_version text,
  candidate_snapshot_version text,
  racing_snapshot_version text,
  discovery_snapshot_version text,
  maiden_snapshot_version text,
  breeding_snapshot_version text,
  lineage_snapshot_version text,
  market_snapshot_version text,
  data_current_through timestamptz,
  latest_accepted_import_at timestamptz,
  evaluated_at timestamptz,
  published_at timestamptz,
  snapshot_sha256 text,
  snapshot_json text
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
    RAISE EXCEPTION 'owner-scoped Lifecycle ranking read denied';
  END IF;
  RETURN QUERY
    SELECT snapshot.ranking_id,
      snapshot.configuration_version,
      snapshot.candidate_snapshot_version,
      snapshot.racing_snapshot_version,
      snapshot.discovery_snapshot_version,
      snapshot.maiden_snapshot_version,
      snapshot.breeding_snapshot_version,
      snapshot.lineage_snapshot_version,
      snapshot.market_snapshot_version,
      snapshot.data_current_through,
      snapshot.latest_accepted_import_at,
      snapshot.evaluated_at,
      snapshot.published_at,
      snapshot.snapshot_sha256,
      snapshot.snapshot_json
    FROM dna.lifecycle_ranking_evidence_snapshot snapshot
    WHERE snapshot.owner_id = p_owner_id
    LIMIT 1;
END
$function$;

REVOKE ALL ON TABLE dna.lifecycle_ranking_evidence_snapshot FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_lifecycle_ranking_evidence_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_lifecycle_ranking_evidence_snapshot(uuid) TO dna_app_runtime;

COMMIT;
