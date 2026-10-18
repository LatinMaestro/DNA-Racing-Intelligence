BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1440000-0000-4000-8000-000000000001', 'smoke_horse_pool_owner'),
  ('a1440000-0000-4000-8000-000000000002', 'smoke_horse_pool_other');

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime',
      'dna.tournament_horse_opponent_pool_snapshot',
      'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('dna_app_runtime',
      'dna.tournament_horse_opponent_pool_snapshot_active',
      'SELECT,INSERT,UPDATE,DELETE')
    OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid = 'dna.tournament_horse_opponent_pool_snapshot'::regclass)
    OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid = 'dna.tournament_horse_opponent_pool_snapshot_active'::regclass)
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.publish_tournament_horse_opponent_pool_snapshot(uuid,text,text,text,timestamptz)',
      'EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_active_tournament_horse_opponent_pool_snapshot(uuid)',
      'EXECUTE')
  THEN
    RAISE EXCEPTION 'Tournament Horse opponent pool security is unsafe';
  END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1440000-0000-4000-8000-000000000001';

DO $publication$
DECLARE
  v_owner constant uuid := 'a1440000-0000-4000-8000-000000000001';
  v_published_at constant timestamptz := '2026-10-18T15:00:00Z';
  v_payload text;
  v_version text;
  v_second_payload text;
  v_second_version text;
  v_status text;
BEGIN
  v_payload := jsonb_build_object(
    'version', 1,
    'state', 'accepted',
    'completeForRosterElements', true,
    'truncated', false,
    'cores', jsonb_build_array(jsonb_build_object(
      'coreId', '201', 'name', 'Opponent', 'element', 'Fire')),
    'groups', jsonb_build_array(jsonb_build_object(
      'element', 'Fire',
      'distanceMetres', 1000,
      'tournamentFieldOpponentCoreIds', jsonb_build_array('201'),
      'topTenPercentOpponentCoreIds', jsonb_build_array('201'),
      'status', 'confirmed')))::text;
  v_version := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');

  SELECT dna.publish_tournament_horse_opponent_pool_snapshot(
    v_owner, v_version, NULL, v_payload, v_published_at) INTO v_status;
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'Horse opponent pool snapshot did not publish';
  END IF;
  IF (SELECT count(*)
      FROM dna.read_active_tournament_horse_opponent_pool_snapshot(v_owner)
      WHERE snapshot_version = v_version
        AND payload_json = v_payload
        AND published_at = v_published_at) <> 1
  THEN
    RAISE EXCEPTION 'Horse opponent pool active read is invalid';
  END IF;

  SELECT dna.publish_tournament_horse_opponent_pool_snapshot(
    v_owner, v_version, v_version, v_payload, v_published_at) INTO v_status;
  IF v_status <> 'unchanged' THEN
    RAISE EXCEPTION 'Horse opponent pool replay was not idempotent';
  END IF;

  v_second_payload := jsonb_set(v_payload::jsonb,
    '{groups,0,distanceMetres}', '1400'::jsonb)::text;
  v_second_version := encode(
    sha256(convert_to(v_second_payload, 'UTF8')), 'hex');
  SELECT dna.publish_tournament_horse_opponent_pool_snapshot(
    v_owner, v_second_version, repeat('f', 64), v_second_payload,
    v_published_at + interval '1 minute') INTO v_status;
  IF v_status <> 'source_changed' THEN
    RAISE EXCEPTION 'Horse opponent pool stale publication was accepted';
  END IF;
  IF (SELECT snapshot_version
      FROM dna.read_active_tournament_horse_opponent_pool_snapshot(v_owner)) <>
      v_version
  THEN
    RAISE EXCEPTION 'Horse opponent pool stale publication replaced last-good';
  END IF;

  BEGIN
    PERFORM dna.read_active_tournament_horse_opponent_pool_snapshot(
      'a1440000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Cross-owner Horse opponent pool read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-owner Horse opponent pool read accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.publish_tournament_horse_opponent_pool_snapshot(
      v_owner, repeat('0', 64), v_version, v_payload, v_published_at);
    RAISE EXCEPTION 'Horse opponent pool invalid digest accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Horse opponent pool invalid digest accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.publish_tournament_horse_opponent_pool_snapshot(
      v_owner,
      encode(sha256(convert_to(jsonb_set(v_payload::jsonb,
        '{groups,0,tournamentFieldOpponentCoreIds}',
        '["999"]'::jsonb)::text, 'UTF8')), 'hex'),
      v_version,
      jsonb_set(v_payload::jsonb,
        '{groups,0,tournamentFieldOpponentCoreIds}', '["999"]'::jsonb)::text,
      v_published_at + interval '1 minute');
    RAISE EXCEPTION 'Unknown Horse opponent Core accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Unknown Horse opponent Core accepted' THEN RAISE; END IF;
  END;
END
$publication$;

RESET ROLE;
ROLLBACK;
