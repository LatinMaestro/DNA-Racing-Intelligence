BEGIN;

CREATE TABLE dna.tournament_horse_screening_snapshot (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  snapshot_version character(64) NOT NULL
    CHECK (snapshot_version ~ '^[a-f0-9]{64}$'),
  payload_json text NOT NULL
    CHECK (octet_length(payload_json) BETWEEN 1 AND 1048576),
  published_at timestamptz NOT NULL CHECK (isfinite(published_at)),
  PRIMARY KEY (owner_id, snapshot_version),
  CHECK (snapshot_version = encode(sha256(convert_to(payload_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(payload_json::jsonb) = 'object'),
  CHECK ((payload_json::jsonb ->> 'modelVersion') =
    'horse-1v1-exact-distance-transfer-v2'),
  CHECK (jsonb_typeof(payload_json::jsonb -> 'candidates') = 'array')
);

CREATE TABLE dna.tournament_horse_screening_snapshot_active (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  snapshot_version character(64) NOT NULL,
  activated_at timestamptz NOT NULL CHECK (isfinite(activated_at)),
  FOREIGN KEY (owner_id, snapshot_version)
    REFERENCES dna.tournament_horse_screening_snapshot(owner_id, snapshot_version)
    ON DELETE RESTRICT
);

ALTER TABLE dna.tournament_horse_screening_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.tournament_horse_screening_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.tournament_horse_screening_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.tournament_horse_screening_snapshot_active ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.tournament_horse_screening_snapshot_active FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.tournament_horse_screening_snapshot_active
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.publish_tournament_horse_screening_snapshot(
  p_owner_id uuid,
  p_snapshot_version text,
  p_expected_active_version text,
  p_payload_json text,
  p_published_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_payload jsonb;
  v_active_version text;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Horse screening publication denied';
  END IF;
  IF p_snapshot_version IS NULL
    OR p_snapshot_version !~ '^[a-f0-9]{64}$'
    OR p_payload_json IS NULL
    OR octet_length(p_payload_json) NOT BETWEEN 1 AND 1048576
    OR p_snapshot_version IS DISTINCT FROM
      encode(sha256(convert_to(p_payload_json, 'UTF8')), 'hex')
    OR p_published_at IS NULL
    OR NOT isfinite(p_published_at)
    OR p_published_at > clock_timestamp()
    OR (p_expected_active_version IS NOT NULL
      AND p_expected_active_version !~ '^[a-f0-9]{64}$')
  THEN
    RAISE EXCEPTION 'Horse screening publication is invalid';
  END IF;
  BEGIN
    v_payload := p_payload_json::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Horse screening publication is invalid';
  END;
  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(v_payload)) <> 4
    OR NOT (v_payload ?& ARRAY[
      'modelVersion', 'evidenceCutoff', 'sourceSnapshotVersion', 'candidates'])
    OR v_payload ->> 'modelVersion' IS DISTINCT FROM
      'horse-1v1-exact-distance-transfer-v2'
    OR jsonb_typeof(v_payload -> 'sourceSnapshotVersion') IS DISTINCT FROM 'string'
    OR octet_length(v_payload ->> 'sourceSnapshotVersion') NOT BETWEEN 1 AND 128
    OR v_payload ->> 'sourceSnapshotVersion' IS DISTINCT FROM
      btrim(v_payload ->> 'sourceSnapshotVersion')
    OR v_payload ->> 'sourceSnapshotVersion' ~ '[[:cntrl:]]'
    OR jsonb_typeof(v_payload -> 'evidenceCutoff') IS DISTINCT FROM 'string'
    OR jsonb_typeof(v_payload -> 'candidates') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_payload -> 'candidates') NOT BETWEEN 1 AND 5000
    OR (v_payload ->> 'evidenceCutoff')::timestamptz > p_published_at
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_payload -> 'candidates') candidate(value)
      WHERE jsonb_typeof(candidate.value) IS DISTINCT FROM 'object'
        OR candidate.value ->> 'coreId' IS NULL
        OR btrim(candidate.value ->> 'coreId') = ''
        OR candidate.value ->> 'element' IS NULL
        OR btrim(candidate.value ->> 'element') = ''
        OR (candidate.value ->> 'distanceMetres')::integer
          NOT IN (1000, 1400, 2200)
        OR candidate.value ->> 'evidenceBasis' IS DISTINCT FROM
          'same_mode_exact_distance_all_accepted_races'
        OR candidate.value ->> 'analyticalStatus' IS DISTINCT FROM 'experimental'
        OR candidate.value ->> 'decisionUseAllowed' IS DISTINCT FROM 'false'
        OR candidate.value ->> 'economicStatus' IS DISTINCT FROM 'unavailable'
    )
    OR (SELECT count(*) FROM jsonb_array_elements(v_payload -> 'candidates')) <>
      (SELECT count(DISTINCT jsonb_build_array(
        candidate.value ->> 'coreId', candidate.value ->> 'element',
        candidate.value ->> 'distanceMetres'))
       FROM jsonb_array_elements(v_payload -> 'candidates') candidate(value))
  THEN
    RAISE EXCEPTION 'Horse screening publication is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 143));
  SELECT active.snapshot_version INTO v_active_version
  FROM dna.tournament_horse_screening_snapshot_active active
  WHERE active.owner_id = p_owner_id
  FOR UPDATE;
  IF v_active_version IS DISTINCT FROM p_expected_active_version THEN
    RETURN 'source_changed';
  END IF;

  INSERT INTO dna.tournament_horse_screening_snapshot (
    owner_id, snapshot_version, payload_json, published_at)
  VALUES (p_owner_id, p_snapshot_version, p_payload_json, p_published_at)
  ON CONFLICT (owner_id, snapshot_version) DO NOTHING;
  IF NOT EXISTS (
    SELECT 1 FROM dna.tournament_horse_screening_snapshot snapshot
    WHERE snapshot.owner_id = p_owner_id
      AND snapshot.snapshot_version = p_snapshot_version
      AND snapshot.payload_json = p_payload_json
      AND snapshot.published_at = p_published_at
  ) THEN
    RAISE EXCEPTION 'Horse screening immutable snapshot conflict';
  END IF;

  INSERT INTO dna.tournament_horse_screening_snapshot_active (
    owner_id, snapshot_version, activated_at)
  VALUES (p_owner_id, p_snapshot_version, p_published_at)
  ON CONFLICT (owner_id) DO UPDATE SET
    snapshot_version = EXCLUDED.snapshot_version,
    activated_at = EXCLUDED.activated_at;
  RETURN CASE WHEN v_active_version = p_snapshot_version
    THEN 'unchanged' ELSE 'published' END;
END
$function$;

CREATE FUNCTION dna.read_active_tournament_horse_screening_snapshot(
  p_owner_id uuid
)
RETURNS TABLE (
  snapshot_version character(64),
  payload_json text,
  published_at timestamptz
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
    RAISE EXCEPTION 'owner-scoped Horse screening read denied';
  END IF;
  RETURN QUERY
  SELECT snapshot.snapshot_version, snapshot.payload_json, snapshot.published_at
  FROM dna.tournament_horse_screening_snapshot_active active
  JOIN dna.tournament_horse_screening_snapshot snapshot
    ON snapshot.owner_id = active.owner_id
   AND snapshot.snapshot_version = active.snapshot_version
  WHERE active.owner_id = p_owner_id;
END
$function$;

REVOKE ALL ON TABLE dna.tournament_horse_screening_snapshot,
  dna.tournament_horse_screening_snapshot_active FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.publish_tournament_horse_screening_snapshot(
  uuid,text,text,text,timestamptz),
  dna.read_active_tournament_horse_screening_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.publish_tournament_horse_screening_snapshot(
  uuid,text,text,text,timestamptz),
  dna.read_active_tournament_horse_screening_snapshot(uuid) TO dna_app_runtime;

COMMIT;
