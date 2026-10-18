BEGIN;

CREATE TABLE dna.tournament_horse_opponent_pool_snapshot (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  snapshot_version character(64) NOT NULL
    CHECK (snapshot_version ~ '^[a-f0-9]{64}$'),
  payload_json text NOT NULL
    CHECK (octet_length(payload_json) BETWEEN 1 AND 1048576),
  published_at timestamptz NOT NULL CHECK (isfinite(published_at)),
  PRIMARY KEY (owner_id, snapshot_version),
  CHECK (snapshot_version = encode(sha256(convert_to(payload_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(payload_json::jsonb) = 'object')
);

CREATE TABLE dna.tournament_horse_opponent_pool_snapshot_active (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  snapshot_version character(64) NOT NULL,
  activated_at timestamptz NOT NULL CHECK (isfinite(activated_at)),
  FOREIGN KEY (owner_id, snapshot_version)
    REFERENCES dna.tournament_horse_opponent_pool_snapshot(owner_id, snapshot_version)
    ON DELETE RESTRICT
);

ALTER TABLE dna.tournament_horse_opponent_pool_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.tournament_horse_opponent_pool_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.tournament_horse_opponent_pool_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.tournament_horse_opponent_pool_snapshot_active ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.tournament_horse_opponent_pool_snapshot_active FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.tournament_horse_opponent_pool_snapshot_active
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.publish_tournament_horse_opponent_pool_snapshot(
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
    RAISE EXCEPTION 'owner-scoped Horse opponent pool publication denied';
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
    RAISE EXCEPTION 'Horse opponent pool publication is invalid';
  END IF;
  BEGIN
    v_payload := p_payload_json::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Horse opponent pool publication is invalid';
  END;
  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(v_payload)) <> 6
    OR NOT (v_payload ?& ARRAY[
      'version', 'state', 'completeForRosterElements', 'truncated',
      'cores', 'groups'])
    OR v_payload ->> 'version' IS DISTINCT FROM '1'
    OR v_payload ->> 'state' NOT IN ('accepted', 'partial', 'unknown')
    OR jsonb_typeof(v_payload -> 'completeForRosterElements')
      IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(v_payload -> 'truncated') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(v_payload -> 'cores') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_payload -> 'cores') NOT BETWEEN 1 AND 512
    OR jsonb_typeof(v_payload -> 'groups') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_payload -> 'groups') NOT BETWEEN 1 AND 96
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_payload -> 'cores') core(value)
      WHERE jsonb_typeof(core.value) IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(core.value)) <> 3
        OR NOT (core.value ?& ARRAY['coreId', 'name', 'element'])
        OR btrim(core.value ->> 'coreId') = ''
        OR btrim(core.value ->> 'name') = ''
        OR core.value ->> 'element' NOT IN ('Metal', 'Fire', 'Earth', 'Water')
        OR core.value ->> 'coreId' ~ '[[:cntrl:]]'
        OR core.value ->> 'name' ~ '[[:cntrl:]]'
        OR length(core.value ->> 'coreId') > 512
        OR length(core.value ->> 'name') > 512
    )
    OR (SELECT count(*) FROM jsonb_array_elements(v_payload -> 'cores')) <>
      (SELECT count(DISTINCT core.value ->> 'coreId')
       FROM jsonb_array_elements(v_payload -> 'cores') core(value))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_payload -> 'groups') group_row(value)
      WHERE jsonb_typeof(group_row.value) IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(group_row.value)) <> 5
        OR NOT (group_row.value ?& ARRAY[
          'element', 'distanceMetres', 'tournamentFieldOpponentCoreIds',
          'topTenPercentOpponentCoreIds', 'status'])
        OR group_row.value ->> 'element' NOT IN ('Metal', 'Fire', 'Earth', 'Water')
        OR (group_row.value ->> 'distanceMetres')::integer
          NOT IN (1000, 1400, 2200)
        OR group_row.value ->> 'status' NOT IN ('confirmed', 'review_required')
        OR jsonb_typeof(group_row.value -> 'tournamentFieldOpponentCoreIds')
          IS DISTINCT FROM 'array'
        OR jsonb_typeof(group_row.value -> 'topTenPercentOpponentCoreIds')
          IS DISTINCT FROM 'array'
        OR jsonb_array_length(
          group_row.value -> 'tournamentFieldOpponentCoreIds') > 512
        OR jsonb_array_length(
          group_row.value -> 'topTenPercentOpponentCoreIds') > 512
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            group_row.value -> 'tournamentFieldOpponentCoreIds') id(value)
          WHERE btrim(id.value) = '' OR length(id.value) > 512
            OR id.value ~ '[[:cntrl:]]')
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            group_row.value -> 'topTenPercentOpponentCoreIds') id(value)
          WHERE btrim(id.value) = '' OR length(id.value) > 512
            OR id.value ~ '[[:cntrl:]]')
    )
    OR (SELECT count(*) FROM jsonb_array_elements(v_payload -> 'groups')) <>
      (SELECT count(DISTINCT jsonb_build_array(
        group_row.value ->> 'element',
        group_row.value ->> 'distanceMetres'))
       FROM jsonb_array_elements(v_payload -> 'groups') group_row(value))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_payload -> 'groups') group_row(value)
      WHERE jsonb_array_length(
          group_row.value -> 'tournamentFieldOpponentCoreIds') <>
        (SELECT count(DISTINCT id.value)
         FROM jsonb_array_elements_text(
           group_row.value -> 'tournamentFieldOpponentCoreIds') id(value))
        OR jsonb_array_length(
          group_row.value -> 'topTenPercentOpponentCoreIds') <>
        (SELECT count(DISTINCT id.value)
         FROM jsonb_array_elements_text(
           group_row.value -> 'topTenPercentOpponentCoreIds') id(value))
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
            (group_row.value -> 'tournamentFieldOpponentCoreIds') ||
            (group_row.value -> 'topTenPercentOpponentCoreIds')) id(value)
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_payload -> 'cores') core(value)
            WHERE core.value ->> 'coreId' = id.value
              AND core.value ->> 'element' = group_row.value ->> 'element'))
    )
    OR (
      v_payload ->> 'state' = 'accepted'
      AND (
        v_payload ->> 'completeForRosterElements' <> 'true'
        OR v_payload ->> 'truncated' <> 'false'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_payload -> 'groups') group_row(value)
          WHERE group_row.value ->> 'status' <> 'confirmed'
            OR jsonb_array_length(
              group_row.value -> 'tournamentFieldOpponentCoreIds') < 1
            OR jsonb_array_length(
              group_row.value -> 'topTenPercentOpponentCoreIds') < 1)
      )
    )
  THEN
    RAISE EXCEPTION 'Horse opponent pool publication is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 144));
  SELECT active.snapshot_version INTO v_active_version
  FROM dna.tournament_horse_opponent_pool_snapshot_active active
  WHERE active.owner_id = p_owner_id
  FOR UPDATE;
  IF v_active_version IS DISTINCT FROM p_expected_active_version THEN
    RETURN 'source_changed';
  END IF;

  INSERT INTO dna.tournament_horse_opponent_pool_snapshot (
    owner_id, snapshot_version, payload_json, published_at)
  VALUES (p_owner_id, p_snapshot_version, p_payload_json, p_published_at)
  ON CONFLICT (owner_id, snapshot_version) DO NOTHING;
  IF NOT EXISTS (
    SELECT 1 FROM dna.tournament_horse_opponent_pool_snapshot snapshot
    WHERE snapshot.owner_id = p_owner_id
      AND snapshot.snapshot_version = p_snapshot_version
      AND snapshot.payload_json = p_payload_json
      AND snapshot.published_at = p_published_at
  ) THEN
    RAISE EXCEPTION 'Horse opponent pool immutable snapshot conflict';
  END IF;

  INSERT INTO dna.tournament_horse_opponent_pool_snapshot_active (
    owner_id, snapshot_version, activated_at)
  VALUES (p_owner_id, p_snapshot_version, p_published_at)
  ON CONFLICT (owner_id) DO UPDATE SET
    snapshot_version = EXCLUDED.snapshot_version,
    activated_at = EXCLUDED.activated_at;
  RETURN CASE WHEN v_active_version = p_snapshot_version
    THEN 'unchanged' ELSE 'published' END;
END
$function$;

CREATE FUNCTION dna.read_active_tournament_horse_opponent_pool_snapshot(
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
    RAISE EXCEPTION 'owner-scoped Horse opponent pool read denied';
  END IF;
  RETURN QUERY
  SELECT snapshot.snapshot_version, snapshot.payload_json, snapshot.published_at
  FROM dna.tournament_horse_opponent_pool_snapshot_active active
  JOIN dna.tournament_horse_opponent_pool_snapshot snapshot
    ON snapshot.owner_id = active.owner_id
   AND snapshot.snapshot_version = active.snapshot_version
  WHERE active.owner_id = p_owner_id;
END
$function$;

REVOKE ALL ON TABLE dna.tournament_horse_opponent_pool_snapshot,
  dna.tournament_horse_opponent_pool_snapshot_active
  FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.publish_tournament_horse_opponent_pool_snapshot(
  uuid,text,text,text,timestamptz),
  dna.read_active_tournament_horse_opponent_pool_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.publish_tournament_horse_opponent_pool_snapshot(
  uuid,text,text,text,timestamptz),
  dna.read_active_tournament_horse_opponent_pool_snapshot(uuid)
  TO dna_app_runtime;

COMMIT;
