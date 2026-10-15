BEGIN;

-- Compact last-good transport storage only. Runtime publication remains absent;
-- a later source-validated materializer must replace this row atomically.
CREATE TABLE dna.maiden_allocation_evidence_snapshot (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_evidence_sha256 text NOT NULL CHECK (source_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  materialized_at timestamptz NOT NULL CHECK (isfinite(materialized_at)),
  snapshot_json text NOT NULL CHECK (octet_length(snapshot_json) BETWEEN 1 AND 524288),
  CHECK (snapshot_sha256 = encode(sha256(convert_to(snapshot_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(snapshot_json::jsonb) IS NOT DISTINCT FROM 'object'),
  CHECK ((snapshot_json::jsonb -> 'version') IS NOT DISTINCT FROM '1'::jsonb),
  CHECK ((snapshot_json::jsonb ->> 'databaseOwnerId') IS NOT DISTINCT FROM owner_id::text),
  CHECK ((snapshot_json::jsonb ->> 'sourceEvidenceSha256') IS NOT DISTINCT FROM source_evidence_sha256),
  CHECK ((snapshot_json::jsonb ->> 'materializedAt') IS NOT NULL),
  CHECK ((snapshot_json::jsonb ->> 'materializedAt')::timestamptz IS NOT DISTINCT FROM materialized_at),
  CHECK (jsonb_typeof(snapshot_json::jsonb -> 'evidence') IS NOT DISTINCT FROM 'object')
);

ALTER TABLE dna.maiden_allocation_evidence_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.maiden_allocation_evidence_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.maiden_allocation_evidence_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_maiden_allocation_evidence_snapshot(
  p_owner_id uuid
)
RETURNS TABLE (
  source_evidence_sha256 text,
  snapshot_json text,
  snapshot_sha256 text
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
    RAISE EXCEPTION 'owner-scoped Maiden allocation evidence read denied';
  END IF;
  RETURN QUERY
    SELECT snapshot.source_evidence_sha256,
      snapshot.snapshot_json,
      snapshot.snapshot_sha256
    FROM dna.maiden_allocation_evidence_snapshot snapshot
    WHERE snapshot.owner_id = p_owner_id
    LIMIT 1;
END
$function$;

REVOKE ALL ON TABLE dna.maiden_allocation_evidence_snapshot FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_maiden_allocation_evidence_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_maiden_allocation_evidence_snapshot(uuid) TO dna_app_runtime;

COMMIT;
