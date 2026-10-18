BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1430000-0000-4000-8000-000000000001', 'smoke_horse_screening_owner'),
  ('a1430000-0000-4000-8000-000000000002', 'smoke_horse_screening_other');

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime',
      'dna.tournament_horse_screening_snapshot', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('dna_app_runtime',
      'dna.tournament_horse_screening_snapshot_active', 'SELECT,INSERT,UPDATE,DELETE')
    OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid = 'dna.tournament_horse_screening_snapshot'::regclass)
    OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid = 'dna.tournament_horse_screening_snapshot_active'::regclass)
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.publish_tournament_horse_screening_snapshot(uuid,text,text,text,timestamptz)',
      'EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_active_tournament_horse_screening_snapshot(uuid)', 'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_proc procedure,
      LATERAL aclexplode(COALESCE(procedure.proacl,
        acldefault('f', procedure.proowner))) acl
      WHERE procedure.oid IN (
        'dna.publish_tournament_horse_screening_snapshot(uuid,text,text,text,timestamptz)'::regprocedure,
        'dna.read_active_tournament_horse_screening_snapshot(uuid)'::regprocedure)
        AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Tournament Horse screening security is unsafe';
  END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1430000-0000-4000-8000-000000000001';

DO $publication$
DECLARE
  v_owner constant uuid := 'a1430000-0000-4000-8000-000000000001';
  v_published_at constant timestamptz := '2026-10-18T12:00:00Z';
  v_candidate jsonb;
  v_payload text;
  v_version text;
  v_second_payload text;
  v_second_version text;
  v_status text;
BEGIN
  v_candidate := jsonb_build_object(
    'coreId', 'horse-7',
    'name', 'Test Horse',
    'element', 'Fire',
    'distanceMetres', 1400,
    'status', 'review_required',
    'disposition', 'inferred_candidate',
    'expectedFieldPWinMillionths', NULL,
    'topTenPercentStressPWinMillionths', NULL,
    'projectedFieldOutperformanceMillionths', 510000,
    'projectedTopTenPercentOutperformanceMillionths', 490000,
    'candidateSampleCount', 12,
    'candidateDirectOneVOneSampleCount', 0,
    'fieldOpponentCoreCount', 4,
    'stressOpponentCoreCount', 2,
    'evidenceBasis', 'same_mode_exact_distance_all_accepted_races',
    'formatTransferStatus', 'inference_only',
    'provenOneVOneSpecialist', false,
    'analyticalStatus', 'experimental',
    'decisionUseAllowed', false,
    'economicStatus', 'unavailable',
    'economicReason', 'CONFIRMED_FEE_PRIZE_RULE_NOT_SUPPLIED',
    'reasons', jsonb_build_array('DIRECT_1V1_INSUFFICIENT_SAMPLE'));
  v_payload := jsonb_build_object(
    'modelVersion', 'horse-1v1-exact-distance-transfer-v2',
    'evidenceCutoff', '2026-10-18T11:00:00.000Z',
    'sourceSnapshotVersion', 'accepted-horse-history-v1',
    'candidates', jsonb_build_array(v_candidate))::text;
  v_version := encode(sha256(convert_to(v_payload, 'UTF8')), 'hex');

  SELECT dna.publish_tournament_horse_screening_snapshot(
    v_owner, v_version, NULL, v_payload, v_published_at) INTO v_status;
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'Horse screening snapshot did not publish';
  END IF;
  IF (SELECT count(*)
      FROM dna.read_active_tournament_horse_screening_snapshot(v_owner)
      WHERE snapshot_version = v_version
        AND payload_json = v_payload
        AND published_at = v_published_at) <> 1
  THEN
    RAISE EXCEPTION 'Horse screening active snapshot read is invalid';
  END IF;

  SELECT dna.publish_tournament_horse_screening_snapshot(
    v_owner, v_version, v_version, v_payload, v_published_at) INTO v_status;
  IF v_status <> 'unchanged' THEN
    RAISE EXCEPTION 'Horse screening replay was not idempotent';
  END IF;

  v_second_payload := jsonb_set(v_payload::jsonb,
    '{sourceSnapshotVersion}', '"accepted-horse-history-v2"'::jsonb)::text;
  v_second_version := encode(sha256(convert_to(v_second_payload, 'UTF8')), 'hex');
  SELECT dna.publish_tournament_horse_screening_snapshot(
    v_owner, v_second_version, repeat('f', 64), v_second_payload,
    v_published_at + interval '1 minute') INTO v_status;
  IF v_status <> 'source_changed' THEN
    RAISE EXCEPTION 'Horse screening stale publication was accepted';
  END IF;
  IF (SELECT snapshot_version
      FROM dna.read_active_tournament_horse_screening_snapshot(v_owner)) <>
      v_version
  THEN
    RAISE EXCEPTION 'Horse screening stale publication replaced last-good';
  END IF;

  BEGIN
    PERFORM dna.read_active_tournament_horse_screening_snapshot(
      'a1430000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'Cross-owner Horse screening read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-owner Horse screening read accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM dna.publish_tournament_horse_screening_snapshot(
      v_owner, repeat('0', 64), v_version, v_payload, v_published_at);
    RAISE EXCEPTION 'Horse screening invalid digest accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Horse screening invalid digest accepted' THEN RAISE; END IF;
  END;
END
$publication$;

RESET ROLE;
ROLLBACK;
