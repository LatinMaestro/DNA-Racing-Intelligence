BEGIN;

-- The website may advance an already accepted Open Race session across the
-- field-lock boundary, but it may not create source evidence or rewrite the
-- frozen Stage A field, eligibility or ranking. The existing snapshot is
-- locked and compared before the replacement is accepted.
CREATE FUNCTION dna.publish_open_race_field_lock(
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
  v_new_session_version text;
  v_new_lock_version text;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped Open Race field lock publication denied';
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
    RAISE EXCEPTION 'Open Race field lock publication candidate is invalid';
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
    RAISE EXCEPTION 'Open Race field lock cannot predate accepted evidence';
  END IF;

  BEGIN
    v_old := v_current.snapshot_json::jsonb;
    v_new := p_snapshot_json::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Open Race field lock publication candidate is invalid';
  END;
  v_new_session_version := v_new -> 'evidence' -> 'bindings' ->> 'sessionVersion';
  v_new_lock_version := v_new -> 'evidence' -> 'bindings' ->> 'lockVersion';

  IF jsonb_typeof(v_new -> 'evidence' -> 'lock') IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_new -> 'evidence' -> 'lock' -> 'enteredCoreIds')
      IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Open Race field lock publication candidate is invalid';
  END IF;

  IF (v_old -> 'evidence' -> 'ranking') IS NULL
    OR (v_old -> 'evidence' -> 'ranking') = 'null'::jsonb
    OR (v_old -> 'evidence' -> 'lock') IS DISTINCT FROM 'null'::jsonb
    OR (v_old -> 'evidence' -> 'observation') IS DISTINCT FROM 'null'::jsonb
    OR (v_old -> 'evidence' -> 'comparison') IS DISTINCT FROM 'null'::jsonb
    OR (v_new -> 'evidence' -> 'observation') IS DISTINCT FROM 'null'::jsonb
    OR (v_new -> 'evidence' -> 'comparison') IS DISTINCT FROM 'null'::jsonb
    OR (v_new -> 'evidence' -> 'field') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'field')
    OR (v_new -> 'evidence' -> 'eligibility') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'eligibility')
    OR (v_new -> 'evidence' -> 'ranking') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'ranking')
    OR (v_new -> 'evidence' -> 'bindings' ->> 'fieldVersion') IS DISTINCT FROM
      v_current.field_version
    OR (v_new -> 'evidence' -> 'bindings' ->> 'eligibilityVersion') IS DISTINCT FROM
      v_current.eligibility_version
    OR (v_new -> 'evidence' -> 'bindings' ->> 'rankingVersion') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'bindings' ->> 'rankingVersion')
    OR (v_new -> 'evidence' -> 'bindings' ->> 'raceImportVersion') IS DISTINCT FROM
      v_current.race_import_version
    OR (v_new -> 'evidence' -> 'bindings' ->> 'vaultSnapshotVersion') IS DISTINCT FROM
      v_current.vault_snapshot_version
    OR (v_new -> 'evidence' -> 'bindings' ->> 'historicalAggregateVersion') IS DISTINCT FROM
      v_current.historical_aggregate_version
    OR v_new_session_version IS NULL
    OR octet_length(v_new_session_version) NOT BETWEEN 1 AND 128
    OR v_new_session_version IS NOT DISTINCT FROM v_current.session_version
    OR v_new_lock_version IS NULL
    OR octet_length(v_new_lock_version) NOT BETWEEN 1 AND 128
    OR jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(v_new, '{publishedAt}', v_old -> 'publishedAt'),
          '{evidence,bindings,sessionVersion}',
          v_old -> 'evidence' -> 'bindings' -> 'sessionVersion'),
        '{evidence,bindings,lockVersion}',
        v_old -> 'evidence' -> 'bindings' -> 'lockVersion'),
      '{evidence,lock}', v_old -> 'evidence' -> 'lock') IS DISTINCT FROM v_old
    OR (v_new ->> 'publishedAt') IS NULL
    OR jsonb_typeof(v_new -> 'publishedAt') IS DISTINCT FROM 'string'
    OR (v_new ->> 'publishedAt')::timestamptz IS DISTINCT FROM p_published_at
    OR (v_new -> 'evidence' -> 'lock' ->> 'lockId') IS NULL
    OR octet_length(v_new -> 'evidence' -> 'lock' ->> 'lockId') NOT BETWEEN 1 AND 128
    OR (v_new -> 'evidence' -> 'lock' ->> 'requestId') IS DISTINCT FROM p_request_id
    OR (v_new -> 'evidence' -> 'lock' ->> 'preEntryRankingId') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'ranking' ->> 'rankingId')
    OR (v_new -> 'evidence' -> 'lock' ->> 'fieldCapturedAt') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'field' ->> 'capturedAt')
    OR (v_new -> 'evidence' -> 'lock' ->> 'rankingEvaluatedAt') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'ranking' ->> 'evaluatedAt')
    OR (v_new -> 'evidence' -> 'lock' ->> 'lockedAt') IS NULL
    OR jsonb_typeof(v_new -> 'evidence' -> 'lock' -> 'lockedAt')
      IS DISTINCT FROM 'string'
    OR (v_new -> 'evidence' -> 'lock' ->> 'lockedAt')::timestamptz
      IS DISTINCT FROM p_published_at
    OR (v_new -> 'evidence' -> 'lock' ->> 'fieldStage') IS DISTINCT FROM 'forming'
    OR (v_new -> 'evidence' -> 'lock' ->> 'gateCount') IS DISTINCT FROM
      (v_old -> 'evidence' -> 'field' ->> 'gateCount')
    OR jsonb_typeof(v_new -> 'evidence' -> 'lock' -> 'gateCount')
      IS DISTINCT FROM 'number'
    OR (v_new -> 'evidence' -> 'lock' ->> 'availableGates') IS DISTINCT FROM '0'
    OR jsonb_typeof(v_new -> 'evidence' -> 'lock' -> 'availableGates')
      IS DISTINCT FROM 'number'
    OR (v_new -> 'evidence' -> 'lock' -> 'userConfirmedCommittedEntry')
      IS DISTINCT FROM 'true'::jsonb
    OR (v_new -> 'evidence' -> 'lock' -> 'allGatesFilled')
      IS DISTINCT FROM 'true'::jsonb
    OR (v_new -> 'evidence' -> 'lock' -> 'raceSetToRun')
      IS DISTINCT FROM 'true'::jsonb
    OR jsonb_array_length(v_new -> 'evidence' -> 'lock' -> 'enteredCoreIds')
      IS DISTINCT FROM ((v_old -> 'evidence' -> 'field' ->> 'gateCount')::integer)
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        v_new -> 'evidence' -> 'lock' -> 'enteredCoreIds') entered(value)
      WHERE jsonb_typeof(entered.value) IS DISTINCT FROM 'string'
        OR btrim(entered.value #>> '{}') = '')
    OR (
      SELECT count(DISTINCT entered.value)
      FROM jsonb_array_elements(
        v_new -> 'evidence' -> 'lock' -> 'enteredCoreIds') entered(value)
    ) IS DISTINCT FROM jsonb_array_length(
      v_new -> 'evidence' -> 'lock' -> 'enteredCoreIds')::bigint
    OR (v_new -> 'evidence' -> 'lock' ->> 'selectedOwnedCoreId') IS NULL
    OR octet_length(v_new -> 'evidence' -> 'lock' ->> 'selectedOwnedCoreId')
      NOT BETWEEN 1 AND 128
    OR NOT (v_new -> 'evidence' -> 'lock' -> 'enteredCoreIds') @>
      jsonb_build_array(v_new -> 'evidence' -> 'lock' ->> 'selectedOwnedCoreId')
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_old -> 'evidence' -> 'ranking' -> 'candidates') candidate(value)
      WHERE candidate.value ->> 'coreId' =
        v_new -> 'evidence' -> 'lock' ->> 'selectedOwnedCoreId')
    OR (
      SELECT array_agg(entered.value #>> '{}' ORDER BY entered.value #>> '{}')
      FROM jsonb_array_elements(
        v_new -> 'evidence' -> 'lock' -> 'enteredCoreIds') entered(value)
    ) IS DISTINCT FROM (
      SELECT array_agg(expected.core_id ORDER BY expected.core_id)
      FROM (
        SELECT v_new -> 'evidence' -> 'lock' ->> 'selectedOwnedCoreId' AS core_id
        UNION ALL
        SELECT opponent.value #>> '{}'
        FROM jsonb_array_elements(
          v_old -> 'evidence' -> 'field' -> 'opponentCoreIds') opponent(value)
      ) expected)
    OR (v_new -> 'evidence' -> 'lock' ->> 'preEntryStatus') IS NULL
    OR (v_new -> 'evidence' -> 'lock' ->> 'preEntryStatus')
      NOT IN ('provisional', 'insufficient_evidence')
    OR (
      (v_new -> 'evidence' -> 'lock' ->> 'preEntryStatus') = 'provisional'
      AND nullif(
        btrim(v_new -> 'evidence' -> 'lock' ->> 'provisionalRecommendedCoreId'), '')
        IS NULL)
    OR (
      (v_new -> 'evidence' -> 'lock' ->> 'preEntryStatus') = 'insufficient_evidence'
      AND (v_new -> 'evidence' -> 'lock' -> 'provisionalRecommendedCoreId')
        IS DISTINCT FROM 'null'::jsonb)
  THEN
    RAISE EXCEPTION 'Open Race field lock must preserve accepted Stage A evidence';
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

REVOKE ALL ON FUNCTION dna.publish_open_race_field_lock(uuid,text,text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.publish_open_race_field_lock(uuid,text,text,text,timestamptz,text,text) TO dna_app_runtime;

COMMIT;
