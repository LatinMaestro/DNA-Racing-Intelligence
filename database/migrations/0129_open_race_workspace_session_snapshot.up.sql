BEGIN;

-- Compact, version-bound Open Race read model. Publication is deliberately
-- outside the website runtime: this table carries accepted point-in-time
-- sessions and frozen field-lock evidence without enabling race/game actions.
CREATE TABLE dna.open_race_workspace_session_snapshot (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  request_id text NOT NULL CHECK (octet_length(request_id) BETWEEN 1 AND 128),
  session_version text NOT NULL CHECK (octet_length(session_version) BETWEEN 1 AND 128),
  field_version text NOT NULL CHECK (octet_length(field_version) BETWEEN 1 AND 128),
  eligibility_version text NOT NULL CHECK (octet_length(eligibility_version) BETWEEN 1 AND 128),
  race_import_version text NOT NULL CHECK (octet_length(race_import_version) BETWEEN 1 AND 128),
  vault_snapshot_version text NOT NULL CHECK (octet_length(vault_snapshot_version) BETWEEN 1 AND 128),
  historical_aggregate_version text NOT NULL CHECK (octet_length(historical_aggregate_version) BETWEEN 1 AND 128),
  mode text NOT NULL CHECK (mode IN ('bike','car','horse')),
  distance_meters integer NOT NULL CHECK (distance_meters > 0),
  field_captured_at timestamptz NOT NULL CHECK (isfinite(field_captured_at)),
  latest_accepted_race_import_at timestamptz NOT NULL CHECK (isfinite(latest_accepted_race_import_at)),
  latest_accepted_vault_import_at timestamptz NOT NULL CHECK (isfinite(latest_accepted_vault_import_at)),
  published_at timestamptz NOT NULL CHECK (isfinite(published_at)),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_json text NOT NULL CHECK (octet_length(snapshot_json) BETWEEN 1 AND 524288),
  PRIMARY KEY (owner_id, request_id),
  CHECK (latest_accepted_race_import_at <= field_captured_at),
  CHECK (snapshot_sha256 = encode(sha256(convert_to(snapshot_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(snapshot_json::jsonb) IS NOT DISTINCT FROM 'object'),
  CHECK ((snapshot_json::jsonb -> 'version') IS NOT DISTINCT FROM '1'::jsonb),
  CHECK ((snapshot_json::jsonb ->> 'databaseOwnerId') IS NOT DISTINCT FROM owner_id::text),
  CHECK ((snapshot_json::jsonb ->> 'publishedAt')::timestamptz IS NOT DISTINCT FROM published_at),
  CHECK (jsonb_typeof(snapshot_json::jsonb -> 'evidence') IS NOT DISTINCT FROM 'object'),
  CHECK ((snapshot_json::jsonb -> 'evidence' -> 'field' ->> 'requestId') IS NOT DISTINCT FROM request_id),
  CHECK ((snapshot_json::jsonb -> 'evidence' -> 'field' ->> 'mode') IS NOT DISTINCT FROM mode),
  CHECK (((snapshot_json::jsonb -> 'evidence' -> 'field' ->> 'distanceMeters')::integer) IS NOT DISTINCT FROM distance_meters),
  CHECK (((snapshot_json::jsonb -> 'evidence' -> 'field' ->> 'capturedAt')::timestamptz) IS NOT DISTINCT FROM field_captured_at),
  CHECK ((snapshot_json::jsonb -> 'evidence' -> 'bindings' ->> 'sessionVersion') IS NOT DISTINCT FROM session_version),
  CHECK ((snapshot_json::jsonb -> 'evidence' -> 'bindings' ->> 'fieldVersion') IS NOT DISTINCT FROM field_version),
  CHECK ((snapshot_json::jsonb -> 'evidence' -> 'bindings' ->> 'eligibilityVersion') IS NOT DISTINCT FROM eligibility_version),
  CHECK ((snapshot_json::jsonb -> 'evidence' -> 'bindings' ->> 'raceImportVersion') IS NOT DISTINCT FROM race_import_version),
  CHECK ((snapshot_json::jsonb -> 'evidence' -> 'bindings' ->> 'vaultSnapshotVersion') IS NOT DISTINCT FROM vault_snapshot_version),
  CHECK ((snapshot_json::jsonb -> 'evidence' -> 'bindings' ->> 'historicalAggregateVersion') IS NOT DISTINCT FROM historical_aggregate_version)
);

ALTER TABLE dna.open_race_workspace_session_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.open_race_workspace_session_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.open_race_workspace_session_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_open_race_workspace_sessions(
  p_owner_id uuid,
  p_limit integer
)
RETURNS TABLE (
  request_id text,
  session_version text,
  field_version text,
  eligibility_version text,
  race_import_version text,
  vault_snapshot_version text,
  historical_aggregate_version text,
  mode text,
  distance_meters integer,
  field_captured_at timestamptz,
  latest_accepted_race_import_at timestamptz,
  latest_accepted_vault_import_at timestamptz,
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
    RAISE EXCEPTION 'owner-scoped Open Race workspace read denied';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 24 THEN
    RAISE EXCEPTION 'Open Race workspace read limit is invalid';
  END IF;
  RETURN QUERY
    SELECT snapshot.request_id,
      snapshot.session_version,
      snapshot.field_version,
      snapshot.eligibility_version,
      snapshot.race_import_version,
      snapshot.vault_snapshot_version,
      snapshot.historical_aggregate_version,
      snapshot.mode,
      snapshot.distance_meters,
      snapshot.field_captured_at,
      snapshot.latest_accepted_race_import_at,
      snapshot.latest_accepted_vault_import_at,
      snapshot.published_at,
      snapshot.snapshot_sha256,
      snapshot.snapshot_json
    FROM dna.open_race_workspace_session_snapshot snapshot
    WHERE snapshot.owner_id = p_owner_id
    ORDER BY snapshot.field_captured_at DESC, snapshot.request_id
    LIMIT p_limit;
END
$function$;

REVOKE ALL ON TABLE dna.open_race_workspace_session_snapshot FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_open_race_workspace_sessions(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_open_race_workspace_sessions(uuid,integer) TO dna_app_runtime;

COMMIT;
