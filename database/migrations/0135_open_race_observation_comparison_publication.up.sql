BEGIN;

-- Publish the optional manual star observation and its diagnostic comparison
-- together. Only the post-lock evidence and their versions may change; the
-- accepted Stage A field/ranking and field lock remain byte-for-byte frozen.
CREATE FUNCTION dna.publish_open_race_observation_comparison(
  p_owner_id uuid,
  p_request_id text,
  p_expected_snapshot_sha256 text,
  p_expected_session_version text,
  p_published_at timestamptz,
  p_snapshot_sha256 text,
  p_snapshot_json text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_current dna.open_race_workspace_session_snapshot%ROWTYPE;
  v_old jsonb;
  v_new jsonb;
  v_observation jsonb;
  v_comparison jsonb;
  v_new_session_version text;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Open Race observation publication denied';
  END IF;
  IF p_request_id IS NULL
    OR octet_length(p_request_id) NOT BETWEEN 1 AND 128
    OR p_expected_snapshot_sha256 IS NULL
    OR p_expected_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    OR p_expected_session_version IS NULL
    OR octet_length(p_expected_session_version) NOT BETWEEN 1 AND 128
    OR p_published_at IS NULL
    OR NOT isfinite(p_published_at)
    OR p_published_at > clock_timestamp()
    OR p_snapshot_sha256 IS NULL
    OR p_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    OR p_snapshot_json IS NULL
    OR octet_length(p_snapshot_json) NOT BETWEEN 1 AND 524288
    OR p_snapshot_sha256 IS DISTINCT FROM
      encode(sha256(convert_to(p_snapshot_json, 'UTF8')), 'hex')
  THEN
    RAISE EXCEPTION 'Open Race observation publication candidate is invalid';
  END IF;

  SELECT snapshot.* INTO v_current
  FROM dna.open_race_workspace_session_snapshot snapshot
  WHERE snapshot.owner_id = p_owner_id
    AND snapshot.request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_current.snapshot_sha256 IS DISTINCT FROM p_expected_snapshot_sha256
    OR v_current.session_version IS DISTINCT FROM p_expected_session_version
  THEN
    RETURN 'source_changed';
  END IF;
  IF v_current.snapshot_sha256 IS NOT DISTINCT FROM p_snapshot_sha256 THEN
    RETURN 'unchanged';
  END IF;
  IF p_published_at < v_current.published_at THEN
    RAISE EXCEPTION 'Open Race observation cannot predate accepted evidence';
  END IF;

  BEGIN
    v_old := v_current.snapshot_json::jsonb;
    v_new := p_snapshot_json::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Open Race observation publication candidate is invalid';
  END;
  v_observation := v_new -> 'evidence' -> 'observation';
  v_comparison := v_new -> 'evidence' -> 'comparison';
  v_new_session_version := v_new -> 'evidence' -> 'bindings' ->> 'sessionVersion';

  IF jsonb_typeof(v_old -> 'evidence' -> 'lock') IS DISTINCT FROM 'object'
    OR (v_old -> 'evidence' -> 'observation') IS DISTINCT FROM 'null'::jsonb
    OR (v_old -> 'evidence' -> 'comparison') IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(v_observation) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_comparison) IS DISTINCT FROM 'object'
    OR v_new_session_version IS NULL
    OR octet_length(v_new_session_version) NOT BETWEEN 1 AND 128
    OR v_new_session_version IS NOT DISTINCT FROM v_current.session_version
    OR nullif(btrim(v_new -> 'evidence' -> 'bindings' ->> 'observationVersion'), '') IS NULL
    OR nullif(btrim(v_new -> 'evidence' -> 'bindings' ->> 'comparisonVersion'), '') IS NULL
    OR (v_new -> 'evidence' -> 'bindings' ->> 'lockVersion') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'bindings' ->> 'lockVersion')
    OR jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(v_new, '{publishedAt}', v_old -> 'publishedAt'),
              '{evidence,bindings,sessionVersion}',
              v_old -> 'evidence' -> 'bindings' -> 'sessionVersion'),
            '{evidence,bindings,observationVersion}',
            v_old -> 'evidence' -> 'bindings' -> 'observationVersion'),
          '{evidence,bindings,comparisonVersion}',
          v_old -> 'evidence' -> 'bindings' -> 'comparisonVersion'),
        '{evidence,observation}', v_old -> 'evidence' -> 'observation'),
      '{evidence,comparison}', v_old -> 'evidence' -> 'comparison')
      IS DISTINCT FROM v_old
    OR jsonb_typeof(v_new -> 'publishedAt') IS DISTINCT FROM 'string'
    OR (v_new ->> 'publishedAt')::timestamptz IS DISTINCT FROM p_published_at
    OR nullif(btrim(v_observation ->> 'observationId'), '') IS NULL
    OR (v_observation ->> 'lockId') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'lock' ->> 'lockId')
    OR (v_observation ->> 'lockedAt') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'lock' ->> 'lockedAt')
    OR (v_observation ->> 'observedAt')::timestamptz IS DISTINCT FROM p_published_at
    OR (v_observation ->> 'fieldStage') IS DISTINCT FROM 'locked_observation'
    OR (v_observation ->> 'gateCount') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'lock' ->> 'gateCount')
    OR (v_observation -> 'enteredCoreIds') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'lock' -> 'enteredCoreIds')
    OR (v_observation ->> 'selectedOwnedCoreId') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'lock' ->> 'selectedOwnedCoreId')
    OR (v_observation -> 'gold' ->> 'status') IS NULL
    OR (v_observation -> 'gold' ->> 'status') NOT IN
      ('assigned','not_assigned','not_observed','not_applicable')
    OR (v_observation -> 'blue' ->> 'status') IS NULL
    OR (v_observation -> 'blue' ->> 'status') NOT IN
      ('assigned','not_assigned','not_observed')
    OR (
      (v_observation -> 'gold' ->> 'status') = 'assigned'
      AND (
        nullif(btrim(v_observation -> 'gold' ->> 'coreId'), '') IS NULL
        OR NOT (v_observation -> 'enteredCoreIds') @>
          jsonb_build_array(v_observation -> 'gold' ->> 'coreId')))
    OR (
      (v_observation -> 'blue' ->> 'status') = 'assigned'
      AND (
        nullif(btrim(v_observation -> 'blue' ->> 'coreId'), '') IS NULL
        OR NOT (v_observation -> 'enteredCoreIds') @>
          jsonb_build_array(v_observation -> 'blue' ->> 'coreId')))
    OR nullif(btrim(v_comparison ->> 'comparisonId'), '') IS NULL
    OR (v_comparison ->> 'lockId') IS DISTINCT FROM (v_observation ->> 'lockId')
    OR (v_comparison ->> 'observationId') IS DISTINCT FROM
      (v_observation ->> 'observationId')
    OR (v_comparison ->> 'rankingEvaluatedAt') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'ranking' ->> 'evaluatedAt')
    OR (v_comparison ->> 'lockedAt') IS DISTINCT FROM (v_observation ->> 'lockedAt')
    OR (v_comparison ->> 'observedAt') IS DISTINCT FROM (v_observation ->> 'observedAt')
    OR (v_comparison ->> 'comparedAt')::timestamptz IS DISTINCT FROM p_published_at
    OR (v_comparison ->> 'gateCount') IS DISTINCT FROM (v_observation ->> 'gateCount')
    OR (v_comparison -> 'enteredCoreIds') IS DISTINCT FROM
      (v_observation -> 'enteredCoreIds')
    OR (v_comparison ->> 'selectedOwnedCoreId') IS DISTINCT FROM
      (v_observation ->> 'selectedOwnedCoreId')
    OR (v_comparison -> 'rankedCandidateCoreIds') IS DISTINCT FROM (
      SELECT jsonb_agg(candidate.value -> 'coreId')
      FROM jsonb_array_elements(
        v_old -> 'evidence' -> 'ranking' -> 'candidates') candidate(value))
    OR (v_comparison -> 'provisionalRecommendedCoreId') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'lock' -> 'provisionalRecommendedCoreId')
    OR (v_comparison -> 'gold') IS DISTINCT FROM (v_observation -> 'gold')
    OR (v_comparison -> 'blue') IS DISTINCT FROM (v_observation -> 'blue')
    OR (v_comparison ->> 'observationRecordStatus') IS NULL
    OR (v_comparison ->> 'observationRecordStatus') NOT IN
      ('recorded','review_required')
  THEN
    RAISE EXCEPTION 'Open Race observation must preserve accepted lock and ranking evidence';
  END IF;

  UPDATE dna.open_race_workspace_session_snapshot SET
    session_version = v_new_session_version,
    published_at = p_published_at,
    snapshot_sha256 = p_snapshot_sha256,
    snapshot_json = p_snapshot_json
  WHERE owner_id = p_owner_id AND request_id = p_request_id;
  RETURN 'published';
END
$function$;

REVOKE ALL ON FUNCTION dna.publish_open_race_observation_comparison(uuid,text,text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.publish_open_race_observation_comparison(uuid,text,text,text,timestamptz,text,text) TO dna_app_runtime;

COMMIT;
