BEGIN;

-- Compact accepted owner readiness evidence only. This boundary never scans
-- operational tables during page composition and exposes no runtime writes.
CREATE TABLE dna.private_readiness_assessment_snapshot (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  assessment_id text NOT NULL CHECK (btrim(assessment_id) <> ''),
  assessment_version text NOT NULL CHECK (btrim(assessment_version) <> ''),
  exact_head_sha text NOT NULL CHECK (exact_head_sha ~ '^[a-f0-9]{40}$'),
  evidence_current_through timestamptz NOT NULL CHECK (isfinite(evidence_current_through)),
  assessed_at timestamptz NOT NULL CHECK (isfinite(assessed_at)),
  published_at timestamptz NOT NULL CHECK (isfinite(published_at)),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_json text NOT NULL CHECK (octet_length(snapshot_json) BETWEEN 1 AND 32768),
  CHECK (evidence_current_through <= assessed_at),
  CHECK (assessed_at <= published_at),
  CHECK (snapshot_sha256 = encode(sha256(convert_to(snapshot_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(snapshot_json::jsonb) IS NOT DISTINCT FROM 'object'),
  CHECK ((snapshot_json::jsonb -> 'version') IS NOT DISTINCT FROM '1'::jsonb),
  CHECK ((snapshot_json::jsonb ->> 'databaseOwnerId') IS NOT DISTINCT FROM owner_id::text),
  CHECK ((snapshot_json::jsonb ->> 'publishedAt')::timestamptz IS NOT DISTINCT FROM published_at),
  CHECK (jsonb_typeof(snapshot_json::jsonb -> 'assessment') IS NOT DISTINCT FROM 'object'),
  CHECK ((snapshot_json::jsonb #>> '{assessment,assessmentId}') IS NOT DISTINCT FROM assessment_id),
  CHECK ((snapshot_json::jsonb #>> '{assessment,assessmentVersion}') IS NOT DISTINCT FROM assessment_version),
  CHECK ((snapshot_json::jsonb #>> '{assessment,exactHeadSha}') IS NOT DISTINCT FROM exact_head_sha),
  CHECK ((snapshot_json::jsonb #>> '{assessment,evidenceCurrentThrough}')::timestamptz IS NOT DISTINCT FROM evidence_current_through),
  CHECK ((snapshot_json::jsonb #>> '{assessment,assessedAt}')::timestamptz IS NOT DISTINCT FROM assessed_at)
);

ALTER TABLE dna.private_readiness_assessment_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.private_readiness_assessment_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.private_readiness_assessment_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_private_readiness_assessment_snapshot(p_owner_id uuid)
RETURNS TABLE (
  assessment_id text,
  assessment_version text,
  exact_head_sha text,
  evidence_current_through timestamptz,
  assessed_at timestamptz,
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
    RAISE EXCEPTION 'owner-scoped readiness assessment read denied';
  END IF;
  RETURN QUERY
    SELECT snapshot.assessment_id,
      snapshot.assessment_version,
      snapshot.exact_head_sha,
      snapshot.evidence_current_through,
      snapshot.assessed_at,
      snapshot.published_at,
      snapshot.snapshot_sha256,
      snapshot.snapshot_json
    FROM dna.private_readiness_assessment_snapshot snapshot
    WHERE snapshot.owner_id = p_owner_id
    LIMIT 1;
END
$function$;

REVOKE ALL ON TABLE dna.private_readiness_assessment_snapshot FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_private_readiness_assessment_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_private_readiness_assessment_snapshot(uuid) TO dna_app_runtime;

COMMIT;
