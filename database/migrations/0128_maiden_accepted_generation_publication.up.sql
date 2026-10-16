BEGIN;

-- Operator-accepted, versioned analytical input. This is deliberately separate
-- from the compact page snapshot: runtime can read it only through bounded
-- functions and cannot replace the accepted generation directly.
CREATE TABLE dna.maiden_allocation_accepted_generation (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_evidence_sha256 text NOT NULL CHECK (source_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  source_identity_json text NOT NULL CHECK (octet_length(source_identity_json) BETWEEN 2 AND 65536),
  generation_json text NOT NULL CHECK (octet_length(generation_json) BETWEEN 2 AND 2097152),
  accepted_at timestamptz NOT NULL CHECK (isfinite(accepted_at)),
  CHECK (source_evidence_sha256 = encode(sha256(convert_to(source_identity_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(source_identity_json::jsonb) IS NOT DISTINCT FROM 'object'),
  CHECK (jsonb_typeof(generation_json::jsonb) IS NOT DISTINCT FROM 'object'),
  CHECK ((generation_json::jsonb ->> 'databaseOwnerId') IS NOT DISTINCT FROM owner_id::text),
  CHECK ((generation_json::jsonb ->> 'sourceEvidenceSha256') IS NOT DISTINCT FROM source_evidence_sha256),
  CHECK (jsonb_typeof(generation_json::jsonb -> 'coverage') IS NOT DISTINCT FROM 'object'),
  CHECK (jsonb_typeof(generation_json::jsonb -> 'evidence') IS NOT DISTINCT FROM 'object')
);

ALTER TABLE dna.maiden_allocation_accepted_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.maiden_allocation_accepted_generation FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.maiden_allocation_accepted_generation
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_maiden_allocation_accepted_generation(p_owner_id uuid)
RETURNS TABLE (source_evidence_sha256 text, generation_json text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Maiden accepted generation read denied';
  END IF;
  RETURN QUERY
    SELECT generation.source_evidence_sha256, generation.generation_json
    FROM dna.maiden_allocation_accepted_generation generation
    WHERE generation.owner_id = p_owner_id
    LIMIT 1;
END
$function$;

CREATE FUNCTION dna.read_maiden_allocation_accepted_source_identity(p_owner_id uuid)
RETURNS TABLE (source_evidence_sha256 text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Maiden accepted identity read denied';
  END IF;
  RETURN QUERY
    SELECT generation.source_evidence_sha256
    FROM dna.maiden_allocation_accepted_generation generation
    WHERE generation.owner_id = p_owner_id
    LIMIT 1;
END
$function$;

CREATE FUNCTION dna.publish_maiden_allocation_evidence_snapshot(
  p_owner_id uuid,
  p_expected_source_evidence_sha256 text,
  p_materialized_at timestamptz,
  p_snapshot_json text,
  p_snapshot_sha256 text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_source text;
  v_existing_source text;
  v_existing_snapshot text;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Maiden evidence publication denied';
  END IF;
  IF p_expected_source_evidence_sha256 IS NULL
    OR p_expected_source_evidence_sha256 !~ '^[a-f0-9]{64}$'
    OR p_snapshot_sha256 IS NULL
    OR p_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    OR p_materialized_at IS NULL
    OR NOT isfinite(p_materialized_at)
    OR p_materialized_at > clock_timestamp()
    OR p_snapshot_json IS NULL
    OR octet_length(p_snapshot_json) NOT BETWEEN 1 AND 524288
  THEN
    RAISE EXCEPTION 'Maiden evidence publication candidate is invalid';
  END IF;

  SELECT generation.source_evidence_sha256 INTO v_source
  FROM dna.maiden_allocation_accepted_generation generation
  WHERE generation.owner_id = p_owner_id
  FOR UPDATE;
  IF v_source IS DISTINCT FROM p_expected_source_evidence_sha256 THEN
    RETURN 'source_changed';
  END IF;

  SELECT snapshot.source_evidence_sha256, snapshot.snapshot_sha256
  INTO v_existing_source, v_existing_snapshot
  FROM dna.maiden_allocation_evidence_snapshot snapshot
  WHERE snapshot.owner_id = p_owner_id;
  IF v_existing_source IS NOT DISTINCT FROM p_expected_source_evidence_sha256
    AND v_existing_snapshot IS NOT DISTINCT FROM p_snapshot_sha256
  THEN
    RETURN 'unchanged';
  END IF;

  INSERT INTO dna.maiden_allocation_evidence_snapshot (
    owner_id, source_evidence_sha256, snapshot_sha256, materialized_at,
    snapshot_json
  ) VALUES (
    p_owner_id, p_expected_source_evidence_sha256, p_snapshot_sha256,
    p_materialized_at, p_snapshot_json
  )
  ON CONFLICT (owner_id) DO UPDATE SET
    source_evidence_sha256 = EXCLUDED.source_evidence_sha256,
    snapshot_sha256 = EXCLUDED.snapshot_sha256,
    materialized_at = EXCLUDED.materialized_at,
    snapshot_json = EXCLUDED.snapshot_json;
  RETURN 'published';
END
$function$;

REVOKE ALL ON TABLE dna.maiden_allocation_accepted_generation FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_maiden_allocation_accepted_generation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_maiden_allocation_accepted_source_identity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_maiden_allocation_evidence_snapshot(uuid,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_maiden_allocation_accepted_generation(uuid) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_maiden_allocation_accepted_source_identity(uuid) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_maiden_allocation_evidence_snapshot(uuid,text,timestamptz,text,text) TO dna_app_runtime;

COMMIT;
