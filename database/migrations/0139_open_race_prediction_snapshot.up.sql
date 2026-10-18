BEGIN;

-- Immutable, owner-scoped pre-event forecasts. The runtime may only append a
-- snapshot that exactly matches an already accepted, locked Open Race session.
CREATE TABLE dna.open_race_prediction_snapshot (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  snapshot_id text NOT NULL CHECK (octet_length(snapshot_id) BETWEEN 1 AND 512),
  request_id text NOT NULL CHECK (octet_length(request_id) BETWEEN 1 AND 128),
  event_id text NOT NULL CHECK (octet_length(event_id) BETWEEN 1 AND 128),
  predicted_at timestamptz NOT NULL CHECK (isfinite(predicted_at)),
  event_starts_at timestamptz NOT NULL CHECK (isfinite(event_starts_at)),
  evidence_cutoff timestamptz NOT NULL CHECK (isfinite(evidence_cutoff)),
  model_version text NOT NULL CHECK (octet_length(model_version) BETWEEN 1 AND 128),
  session_version text NOT NULL CHECK (octet_length(session_version) BETWEEN 1 AND 128),
  field_version text NOT NULL CHECK (octet_length(field_version) BETWEEN 1 AND 128),
  eligibility_version text NOT NULL CHECK (octet_length(eligibility_version) BETWEEN 1 AND 128),
  lock_version text NOT NULL CHECK (octet_length(lock_version) BETWEEN 1 AND 128),
  race_import_version text NOT NULL CHECK (octet_length(race_import_version) BETWEEN 1 AND 128),
  vault_snapshot_version text NOT NULL CHECK (octet_length(vault_snapshot_version) BETWEEN 1 AND 128),
  historical_aggregate_version text NOT NULL CHECK (octet_length(historical_aggregate_version) BETWEEN 1 AND 128),
  history_generation_version text NOT NULL CHECK (octet_length(history_generation_version) BETWEEN 1 AND 128),
  history_source_identity_sha256 text NOT NULL CHECK (history_source_identity_sha256 ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL CHECK (isfinite(published_at)),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_json text NOT NULL CHECK (octet_length(snapshot_json) BETWEEN 1 AND 524288),
  PRIMARY KEY (owner_id, snapshot_id),
  UNIQUE (owner_id, event_id, model_version, lock_version),
  CHECK (evidence_cutoff <= predicted_at),
  CHECK (predicted_at < event_starts_at),
  CHECK (predicted_at <= published_at),
  CHECK (published_at < event_starts_at),
  CHECK (snapshot_sha256 = encode(sha256(convert_to(snapshot_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(snapshot_json::jsonb) IS NOT DISTINCT FROM 'object'),
  CHECK ((snapshot_json::jsonb -> 'version') IS NOT DISTINCT FROM '1'::jsonb),
  CHECK ((snapshot_json::jsonb ->> 'databaseOwnerId') IS NOT DISTINCT FROM owner_id::text),
  CHECK ((snapshot_json::jsonb ->> 'requestId') IS NOT DISTINCT FROM request_id),
  CHECK ((snapshot_json::jsonb ->> 'publishedAt')::timestamptz IS NOT DISTINCT FROM published_at),
  CHECK ((snapshot_json::jsonb -> 'snapshot' ->> 'snapshotId') IS NOT DISTINCT FROM snapshot_id),
  CHECK ((snapshot_json::jsonb -> 'snapshot' ->> 'eventId') IS NOT DISTINCT FROM event_id),
  CHECK ((snapshot_json::jsonb -> 'snapshot' ->> 'predictedAt')::timestamptz IS NOT DISTINCT FROM predicted_at),
  CHECK ((snapshot_json::jsonb -> 'snapshot' ->> 'eventStartsAt')::timestamptz IS NOT DISTINCT FROM event_starts_at),
  CHECK ((snapshot_json::jsonb -> 'snapshot' ->> 'evidenceCutoff')::timestamptz IS NOT DISTINCT FROM evidence_cutoff),
  CHECK ((snapshot_json::jsonb -> 'snapshot' ->> 'modelVersion') IS NOT DISTINCT FROM model_version),
  CHECK ((snapshot_json::jsonb -> 'snapshot' -> 'field' ->> 'fieldVersion') IS NOT DISTINCT FROM field_version),
  CHECK ((snapshot_json::jsonb -> 'snapshot' -> 'sources' ->> 'sessionVersion') IS NOT DISTINCT FROM session_version),
  CHECK ((snapshot_json::jsonb -> 'snapshot' -> 'sources' ->> 'eligibilityVersion') IS NOT DISTINCT FROM eligibility_version),
  CHECK ((snapshot_json::jsonb -> 'snapshot' -> 'sources' ->> 'lockVersion') IS NOT DISTINCT FROM lock_version),
  CHECK ((snapshot_json::jsonb -> 'snapshot' -> 'sources' ->> 'raceImportVersion') IS NOT DISTINCT FROM race_import_version),
  CHECK ((snapshot_json::jsonb -> 'snapshot' -> 'sources' ->> 'vaultSnapshotVersion') IS NOT DISTINCT FROM vault_snapshot_version),
  CHECK ((snapshot_json::jsonb -> 'snapshot' -> 'sources' ->> 'historicalAggregateVersion') IS NOT DISTINCT FROM historical_aggregate_version),
  CHECK ((snapshot_json::jsonb -> 'snapshot' -> 'sources' ->> 'historyGenerationVersion') IS NOT DISTINCT FROM history_generation_version),
  CHECK ((snapshot_json::jsonb -> 'snapshot' -> 'sources' ->> 'historySourceIdentitySha256') IS NOT DISTINCT FROM history_source_identity_sha256)
);

ALTER TABLE dna.open_race_prediction_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.open_race_prediction_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.open_race_prediction_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_open_race_prediction_snapshots(p_owner_id uuid, p_limit integer)
RETURNS TABLE (snapshot_id text, request_id text, event_id text, predicted_at timestamptz,
  published_at timestamptz, snapshot_sha256 text, snapshot_json text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id IS DISTINCT FROM dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Open Race prediction read denied';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 24 THEN
    RAISE EXCEPTION 'Open Race prediction read limit is invalid';
  END IF;
  RETURN QUERY SELECT snapshot.snapshot_id, snapshot.request_id, snapshot.event_id,
    snapshot.predicted_at, snapshot.published_at, snapshot.snapshot_sha256, snapshot.snapshot_json
  FROM dna.open_race_prediction_snapshot snapshot
  WHERE snapshot.owner_id = p_owner_id
  ORDER BY snapshot.predicted_at DESC, snapshot.snapshot_id
  LIMIT p_limit;
END
$function$;

CREATE FUNCTION dna.publish_open_race_prediction_snapshot(
  p_owner_id uuid, p_request_id text, p_expected_workspace_sha256 text,
  p_snapshot_sha256 text, p_snapshot_json text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_workspace dna.open_race_workspace_session_snapshot%ROWTYPE;
  v_workspace_json jsonb;
  v_envelope jsonb;
  v_snapshot jsonb;
  v_existing dna.open_race_prediction_snapshot%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id IS DISTINCT FROM dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Open Race prediction publication denied';
  END IF;
  IF p_request_id IS NULL OR octet_length(p_request_id) NOT BETWEEN 1 AND 128
    OR p_expected_workspace_sha256 IS NULL OR p_expected_workspace_sha256 !~ '^[a-f0-9]{64}$'
    OR p_snapshot_sha256 IS NULL OR p_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    OR p_snapshot_json IS NULL OR octet_length(p_snapshot_json) NOT BETWEEN 1 AND 524288
    OR p_snapshot_sha256 IS DISTINCT FROM encode(sha256(convert_to(p_snapshot_json, 'UTF8')), 'hex')
  THEN RAISE EXCEPTION 'Open Race prediction publication candidate is invalid'; END IF;

  SELECT workspace.* INTO v_workspace
  FROM dna.open_race_workspace_session_snapshot workspace
  WHERE workspace.owner_id = p_owner_id AND workspace.request_id = p_request_id
  FOR SHARE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_workspace.snapshot_sha256 IS DISTINCT FROM p_expected_workspace_sha256 THEN
    RETURN 'source_changed';
  END IF;

  BEGIN
    v_workspace_json := v_workspace.snapshot_json::jsonb;
    v_envelope := p_snapshot_json::jsonb;
    v_snapshot := v_envelope -> 'snapshot';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Open Race prediction publication candidate is invalid';
  END;
  IF jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object'
    OR (v_envelope -> 'version') IS DISTINCT FROM '1'::jsonb
    OR (v_envelope ->> 'databaseOwnerId') IS DISTINCT FROM p_owner_id::text
    OR (v_envelope ->> 'requestId') IS DISTINCT FROM p_request_id
    OR (v_envelope ->> 'publishedAt') IS NULL
    OR (v_envelope ->> 'publishedAt')::timestamptz > clock_timestamp()
    OR (v_snapshot -> 'frozen') IS DISTINCT FROM 'true'::jsonb
    OR (v_snapshot -> 'predictionMutationAllowed') IS DISTINCT FROM 'false'::jsonb
    OR (v_snapshot -> 'sameEventEvidenceIncluded') IS DISTINCT FROM 'false'::jsonb
    OR (v_snapshot -> 'observedOutcomeIncluded') IS DISTINCT FROM 'false'::jsonb
    OR (v_snapshot -> 'fairExOddsIncluded') IS DISTINCT FROM 'false'::jsonb
    OR (v_snapshot ->> 'reconciliationStatus') IS DISTINCT FROM 'pending'
    OR (v_workspace_json -> 'evidence' -> 'lock') IS NULL
    OR (v_workspace_json -> 'evidence' -> 'lock') = 'null'::jsonb
    OR (v_workspace_json -> 'evidence' -> 'observation') IS DISTINCT FROM 'null'::jsonb
    OR (v_workspace_json -> 'evidence' -> 'comparison') IS DISTINCT FROM 'null'::jsonb
    OR (v_snapshot -> 'sources' ->> 'sessionVersion') IS DISTINCT FROM v_workspace.session_version
    OR (v_snapshot -> 'field' ->> 'fieldVersion') IS DISTINCT FROM v_workspace.field_version
    OR (v_snapshot -> 'sources' ->> 'eligibilityVersion') IS DISTINCT FROM v_workspace.eligibility_version
    OR (v_snapshot -> 'sources' ->> 'lockVersion') IS DISTINCT FROM
      (v_workspace_json -> 'evidence' -> 'bindings' ->> 'lockVersion')
    OR (v_snapshot -> 'sources' ->> 'raceImportVersion') IS DISTINCT FROM v_workspace.race_import_version
    OR (v_snapshot -> 'sources' ->> 'vaultSnapshotVersion') IS DISTINCT FROM v_workspace.vault_snapshot_version
    OR (v_snapshot -> 'sources' ->> 'historicalAggregateVersion') IS DISTINCT FROM v_workspace.historical_aggregate_version
    OR (v_snapshot ->> 'eventId') IS DISTINCT FROM
      (v_workspace_json -> 'evidence' -> 'field' -> 'eventIdentity' ->> 'eventId')
    OR (v_snapshot ->> 'eventStartsAt')::timestamptz IS DISTINCT FROM
      (v_workspace_json -> 'evidence' -> 'field' ->> 'eventStartsAt')::timestamptz
    OR (v_snapshot ->> 'predictedAt')::timestamptz <
      (v_workspace_json -> 'evidence' -> 'lock' ->> 'lockedAt')::timestamptz
    OR (v_snapshot ->> 'evidenceCutoff') IS DISTINCT FROM
      (v_workspace_json -> 'evidence' -> 'field' ->> 'dataCurrentThrough')
    OR (v_snapshot -> 'context') IS DISTINCT FROM
      (v_workspace_json -> 'evidence' -> 'field' -> 'probabilityContext')
    OR (v_snapshot -> 'field' ->> 'fieldCapturedAt')::timestamptz IS DISTINCT FROM
      v_workspace.field_captured_at
    OR (v_snapshot -> 'field' -> 'enteredCoreIds') IS DISTINCT FROM
      (v_workspace_json -> 'evidence' -> 'lock' -> 'enteredCoreIds')
    OR jsonb_typeof(v_snapshot -> 'predictions') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_snapshot -> 'predictions') IS DISTINCT FROM 4
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_snapshot -> 'predictions') prediction(value)
      WHERE jsonb_typeof(prediction.value) IS DISTINCT FROM 'object'
        OR prediction.value ->> 'coreId' IS DISTINCT FROM
        v_workspace_json -> 'evidence' -> 'lock' ->> 'selectedOwnedCoreId'
        OR jsonb_typeof(prediction.value -> 'status') IS DISTINCT FROM 'string'
        OR jsonb_typeof(prediction.value -> 'evidenceStatus') IS DISTINCT FROM 'string'
        OR prediction.value ->> 'status' NOT IN
          ('available','unavailable','review_required','not_applicable')
        OR prediction.value ->> 'evidenceStatus' NOT IN
          ('complete','partial','insufficient','unavailable','not_applicable')
        OR ((prediction.value ->> 'status') = 'available') IS DISTINCT FROM
          (jsonb_typeof(prediction.value -> 'probabilityMillionths') = 'number'
            AND (prediction.value ->> 'probabilityMillionths')::numeric BETWEEN 0 AND 1000000
            AND mod((prediction.value ->> 'probabilityMillionths')::numeric, 1) = 0
            AND jsonb_typeof(prediction.value -> 'calculationId') = 'string'
            AND btrim(prediction.value ->> 'calculationId') <> '')
        OR (prediction.value ->> 'status' <> 'available'
          AND (prediction.value -> 'probabilityMillionths' IS DISTINCT FROM 'null'::jsonb
            OR prediction.value -> 'calculationId' IS DISTINCT FROM 'null'::jsonb))
        OR ((prediction.value ->> 'status') = 'not_applicable') IS DISTINCT FROM
          ((prediction.value ->> 'evidenceStatus') = 'not_applicable')
        OR ((v_workspace_json -> 'evidence' -> 'field' ->> 'gateCount')::integer <= 3
          AND prediction.value ->> 'target' = 'yellow_star'
          AND prediction.value ->> 'status' <> 'not_applicable'))
    OR (SELECT count(DISTINCT prediction.value ->> 'target')
      FROM jsonb_array_elements(v_snapshot -> 'predictions') prediction(value)
      WHERE prediction.value ->> 'target' IN ('win','place','blue_star','yellow_star')) IS DISTINCT FROM 4::bigint
  THEN RAISE EXCEPTION 'Open Race prediction must preserve accepted locked evidence'; END IF;

  SELECT snapshot.* INTO v_existing FROM dna.open_race_prediction_snapshot snapshot
  WHERE snapshot.owner_id = p_owner_id AND snapshot.snapshot_id = v_snapshot ->> 'snapshotId';
  IF FOUND THEN
    IF v_existing.snapshot_sha256 IS NOT DISTINCT FROM p_snapshot_sha256 THEN RETURN 'unchanged'; END IF;
    RETURN 'source_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM dna.open_race_prediction_snapshot snapshot
    WHERE snapshot.owner_id = p_owner_id
      AND snapshot.event_id = v_snapshot ->> 'eventId'
      AND snapshot.model_version = v_snapshot ->> 'modelVersion'
      AND snapshot.lock_version = v_snapshot -> 'sources' ->> 'lockVersion')
  THEN RETURN 'source_changed'; END IF;

  INSERT INTO dna.open_race_prediction_snapshot (
    owner_id, snapshot_id, request_id, event_id, predicted_at, event_starts_at,
    evidence_cutoff, model_version, session_version, field_version,
    eligibility_version, lock_version, race_import_version, vault_snapshot_version,
    historical_aggregate_version, history_generation_version,
    history_source_identity_sha256, published_at, snapshot_sha256, snapshot_json)
  VALUES (p_owner_id, v_snapshot ->> 'snapshotId', p_request_id,
    v_snapshot ->> 'eventId', (v_snapshot ->> 'predictedAt')::timestamptz,
    (v_snapshot ->> 'eventStartsAt')::timestamptz,
    (v_snapshot ->> 'evidenceCutoff')::timestamptz, v_snapshot ->> 'modelVersion',
    v_snapshot -> 'sources' ->> 'sessionVersion', v_snapshot -> 'field' ->> 'fieldVersion',
    v_snapshot -> 'sources' ->> 'eligibilityVersion', v_snapshot -> 'sources' ->> 'lockVersion',
    v_snapshot -> 'sources' ->> 'raceImportVersion', v_snapshot -> 'sources' ->> 'vaultSnapshotVersion',
    v_snapshot -> 'sources' ->> 'historicalAggregateVersion',
    v_snapshot -> 'sources' ->> 'historyGenerationVersion',
    v_snapshot -> 'sources' ->> 'historySourceIdentitySha256',
    (v_envelope ->> 'publishedAt')::timestamptz, p_snapshot_sha256, p_snapshot_json);
  RETURN 'published';
END
$function$;

REVOKE ALL ON TABLE dna.open_race_prediction_snapshot FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_open_race_prediction_snapshots(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_open_race_prediction_snapshot(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_open_race_prediction_snapshots(uuid,integer) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_open_race_prediction_snapshot(uuid,text,text,text,text) TO dna_app_runtime;

COMMIT;
