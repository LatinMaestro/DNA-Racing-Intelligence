BEGIN;

-- Append-only accepted-result reconciliation for an immutable pre-event
-- prediction. Corrections add a revision; they never update the forecast or a
-- prior reconciliation.
CREATE TABLE dna.open_race_prediction_reconciliation (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  reconciliation_id text NOT NULL CHECK (octet_length(reconciliation_id) BETWEEN 1 AND 512),
  revision integer NOT NULL CHECK (revision >= 0),
  snapshot_id text NOT NULL,
  event_id text NOT NULL CHECK (octet_length(event_id) BETWEEN 1 AND 128),
  source_evidence_id text NOT NULL CHECK (octet_length(source_evidence_id) BETWEEN 1 AND 512),
  source_version text NOT NULL CHECK (octet_length(source_version) BETWEEN 1 AND 128),
  accepted_at timestamptz NOT NULL CHECK (isfinite(accepted_at)),
  event_completed_at timestamptz NOT NULL CHECK (isfinite(event_completed_at)),
  corrects_source_evidence_id text CHECK (
    corrects_source_evidence_id IS NULL OR octet_length(corrects_source_evidence_id) BETWEEN 1 AND 512),
  record_status text NOT NULL CHECK (record_status IN ('reconciled','review_required')),
  history_update_allowed boolean NOT NULL,
  published_at timestamptz NOT NULL CHECK (isfinite(published_at)),
  reconciliation_sha256 text NOT NULL CHECK (reconciliation_sha256 ~ '^[a-f0-9]{64}$'),
  reconciliation_json text NOT NULL CHECK (octet_length(reconciliation_json) BETWEEN 1 AND 524288),
  PRIMARY KEY (owner_id, reconciliation_id, revision),
  UNIQUE (owner_id, snapshot_id, revision),
  UNIQUE (owner_id, snapshot_id, source_evidence_id),
  FOREIGN KEY (owner_id, snapshot_id)
    REFERENCES dna.open_race_prediction_snapshot(owner_id, snapshot_id),
  CHECK ((revision = 0) = (corrects_source_evidence_id IS NULL)),
  CHECK (event_completed_at <= accepted_at),
  CHECK (accepted_at <= published_at),
  CHECK (history_update_allowed = (record_status = 'reconciled')),
  CHECK (reconciliation_sha256 = encode(sha256(convert_to(reconciliation_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(reconciliation_json::jsonb) IS NOT DISTINCT FROM 'object'),
  CHECK ((reconciliation_json::jsonb -> 'version') IS NOT DISTINCT FROM '1'::jsonb),
  CHECK ((reconciliation_json::jsonb ->> 'databaseOwnerId') IS NOT DISTINCT FROM owner_id::text),
  CHECK ((reconciliation_json::jsonb ->> 'publishedAt')::timestamptz IS NOT DISTINCT FROM published_at),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'reconciliationId') IS NOT DISTINCT FROM reconciliation_id),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'revision')::integer IS NOT DISTINCT FROM revision),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'snapshotId') IS NOT DISTINCT FROM snapshot_id),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'eventId') IS NOT DISTINCT FROM event_id),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'sourceEvidenceId') IS NOT DISTINCT FROM source_evidence_id),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'sourceVersion') IS NOT DISTINCT FROM source_version),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'acceptedAt')::timestamptz IS NOT DISTINCT FROM accepted_at),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'eventCompletedAt')::timestamptz IS NOT DISTINCT FROM event_completed_at),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'correctsSourceEvidenceId') IS NOT DISTINCT FROM corrects_source_evidence_id),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' ->> 'recordStatus') IS NOT DISTINCT FROM record_status),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' -> 'frozenPredictionMutated') IS DISTINCT FROM 'true'::jsonb),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' -> 'frozenPredictionMutated') IS NOT DISTINCT FROM 'false'::jsonb),
  CHECK ((reconciliation_json::jsonb -> 'reconciliation' -> 'historyUpdateAllowed') IS NOT DISTINCT FROM to_jsonb(history_update_allowed))
);

ALTER TABLE dna.open_race_prediction_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.open_race_prediction_reconciliation FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.open_race_prediction_reconciliation
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_open_race_prediction_reconciliations(p_owner_id uuid, p_limit integer)
RETURNS TABLE (reconciliation_id text, revision integer, snapshot_id text, event_id text,
  source_evidence_id text, accepted_at timestamptz, published_at timestamptz,
  reconciliation_sha256 text, reconciliation_json text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id IS DISTINCT FROM dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Open Race prediction reconciliation read denied';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 48 THEN
    RAISE EXCEPTION 'Open Race prediction reconciliation read limit is invalid';
  END IF;
  RETURN QUERY SELECT reconciliation.reconciliation_id, reconciliation.revision,
    reconciliation.snapshot_id, reconciliation.event_id,
    reconciliation.source_evidence_id, reconciliation.accepted_at,
    reconciliation.published_at, reconciliation.reconciliation_sha256,
    reconciliation.reconciliation_json
  FROM dna.open_race_prediction_reconciliation reconciliation
  WHERE reconciliation.owner_id = p_owner_id
  ORDER BY reconciliation.published_at DESC, reconciliation.reconciliation_id,
    reconciliation.revision DESC
  LIMIT p_limit;
END
$function$;

CREATE FUNCTION dna.publish_open_race_prediction_reconciliation(
  p_owner_id uuid, p_expected_snapshot_sha256 text,
  p_reconciliation_sha256 text, p_reconciliation_json text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_envelope jsonb;
  v_reconciliation jsonb;
  v_snapshot dna.open_race_prediction_snapshot%ROWTYPE;
  v_snapshot_body jsonb;
  v_existing dna.open_race_prediction_reconciliation%ROWTYPE;
  v_previous dna.open_race_prediction_reconciliation%ROWTYPE;
  v_previous_reconciliation jsonb;
  v_expected_history jsonb;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id IS DISTINCT FROM dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Open Race prediction reconciliation publication denied';
  END IF;
  IF p_expected_snapshot_sha256 IS NULL OR p_expected_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    OR p_reconciliation_sha256 IS NULL OR p_reconciliation_sha256 !~ '^[a-f0-9]{64}$'
    OR p_reconciliation_json IS NULL OR octet_length(p_reconciliation_json) NOT BETWEEN 1 AND 524288
    OR p_reconciliation_sha256 IS DISTINCT FROM
      encode(sha256(convert_to(p_reconciliation_json, 'UTF8')), 'hex')
  THEN RAISE EXCEPTION 'Open Race prediction reconciliation candidate is invalid'; END IF;

  BEGIN
    v_envelope := p_reconciliation_json::jsonb;
    v_reconciliation := v_envelope -> 'reconciliation';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Open Race prediction reconciliation candidate is invalid';
  END;
  IF jsonb_typeof(v_reconciliation) IS DISTINCT FROM 'object'
    OR (v_envelope -> 'version') IS DISTINCT FROM '1'::jsonb
    OR (v_envelope ->> 'databaseOwnerId') IS DISTINCT FROM p_owner_id::text
    OR (v_envelope ->> 'publishedAt') IS NULL
    OR (v_envelope ->> 'publishedAt')::timestamptz > clock_timestamp()
    OR (v_reconciliation ->> 'reconciliationId') IS NULL
    OR octet_length(v_reconciliation ->> 'reconciliationId') NOT BETWEEN 1 AND 512
    OR (v_reconciliation ->> 'snapshotId') IS NULL
    OR (v_reconciliation ->> 'eventId') IS NULL
    OR (v_reconciliation ->> 'sourceEvidenceId') IS NULL
    OR (v_reconciliation ->> 'sourceVersion') IS NULL
    OR (v_reconciliation ->> 'revision') IS NULL
    OR (v_reconciliation ->> 'revision')::integer < 0
    OR (v_reconciliation -> 'frozenPredictionMutated') IS NOT DISTINCT FROM 'true'::jsonb
    OR (v_reconciliation -> 'frozenPredictionMutated') IS DISTINCT FROM 'false'::jsonb
    OR (v_reconciliation ->> 'recordStatus') NOT IN ('reconciled','review_required')
    OR (v_reconciliation -> 'historyUpdateAllowed') IS DISTINCT FROM
      to_jsonb((v_reconciliation ->> 'recordStatus') = 'reconciled')
    OR jsonb_typeof(v_reconciliation -> 'entries') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_reconciliation -> 'scores') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_reconciliation -> 'issues') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_reconciliation -> 'correctionHistory') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_reconciliation -> 'correctionHistory') IS DISTINCT FROM
      (v_reconciliation ->> 'revision')::integer
  THEN RAISE EXCEPTION 'Open Race prediction reconciliation candidate is invalid'; END IF;

  SELECT snapshot.* INTO v_snapshot
  FROM dna.open_race_prediction_snapshot snapshot
  WHERE snapshot.owner_id = p_owner_id
    AND snapshot.snapshot_id = v_reconciliation ->> 'snapshotId'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_snapshot.snapshot_sha256 IS DISTINCT FROM p_expected_snapshot_sha256 THEN
    RETURN 'source_changed';
  END IF;
  v_snapshot_body := v_snapshot.snapshot_json::jsonb -> 'snapshot';
  IF (v_reconciliation ->> 'eventId') IS DISTINCT FROM v_snapshot.event_id
    OR (v_reconciliation ->> 'eventCompletedAt')::timestamptz < v_snapshot.predicted_at
    OR (v_reconciliation ->> 'acceptedAt')::timestamptz <
      (v_reconciliation ->> 'eventCompletedAt')::timestamptz
    OR (v_envelope ->> 'publishedAt')::timestamptz <
      (v_reconciliation ->> 'acceptedAt')::timestamptz
    OR (v_reconciliation ->> 'outcomeStatus') NOT IN ('complete','partial')
    OR (v_reconciliation ->> 'starDataStatus') NOT IN
      ('complete','partial','missing','invalid')
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_reconciliation -> 'entries') entry(value)
      WHERE jsonb_typeof(entry.value) IS DISTINCT FROM 'object'
        OR jsonb_typeof(entry.value -> 'coreId') IS DISTINCT FROM 'string'
        OR NOT (v_snapshot_body -> 'field' -> 'enteredCoreIds') ? (entry.value ->> 'coreId')
        OR (entry.value -> 'finishPosition' IS DISTINCT FROM 'null'::jsonb
          AND (jsonb_typeof(entry.value -> 'finishPosition') IS DISTINCT FROM 'number'
            OR (entry.value ->> 'finishPosition')::numeric < 1
            OR (entry.value ->> 'finishPosition')::numeric >
              (v_snapshot_body -> 'context' ->> 'gateCount')::integer
            OR mod((entry.value ->> 'finishPosition')::numeric, 1) <> 0))
        OR jsonb_typeof(entry.value -> 'goldStar') NOT IN ('boolean','null')
        OR jsonb_typeof(entry.value -> 'blueStar') NOT IN ('boolean','null'))
    OR (SELECT count(*) FROM jsonb_array_elements(v_reconciliation -> 'entries'))
      IS DISTINCT FROM
      (SELECT count(DISTINCT entry.value ->> 'coreId')
       FROM jsonb_array_elements(v_reconciliation -> 'entries') entry(value))
    OR jsonb_array_length(v_reconciliation -> 'scores') IS DISTINCT FROM
      jsonb_array_length(v_snapshot_body -> 'predictions')
    OR (SELECT count(*) FROM jsonb_array_elements(v_reconciliation -> 'scores'))
      IS DISTINCT FROM
      (SELECT count(DISTINCT (score.value ->> 'coreId', score.value ->> 'target'))
       FROM jsonb_array_elements(v_reconciliation -> 'scores') score(value))
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_reconciliation -> 'scores') score(value)
      LEFT JOIN jsonb_array_elements(v_snapshot_body -> 'predictions') prediction(value)
        ON prediction.value ->> 'coreId' = score.value ->> 'coreId'
        AND prediction.value ->> 'target' = score.value ->> 'target'
      LEFT JOIN jsonb_array_elements(v_reconciliation -> 'entries') entry(value)
        ON entry.value ->> 'coreId' = score.value ->> 'coreId'
      WHERE prediction.value IS NULL
        OR (score.value -> 'predictionProbabilityMillionths') IS DISTINCT FROM
          (prediction.value -> 'probabilityMillionths')
        OR score.value ->> 'scoringStatus' NOT IN ('scored','unscored')
        OR score.value ->> 'reason' NOT IN (
          'prediction_available','prediction_unavailable','prediction_review_required',
          'target_not_applicable','target_definition_unresolved','outcome_incomplete',
          'star_data_incomplete','star_data_invalid')
        OR (score.value ->> 'scoringStatus' = 'scored' AND (
          prediction.value ->> 'status' <> 'available'
          OR score.value ->> 'reason' <> 'prediction_available'
          OR score.value ->> 'target' = 'place'
          OR jsonb_typeof(score.value -> 'actual') IS DISTINCT FROM 'boolean'
          OR entry.value IS NULL
          OR CASE score.value ->> 'target'
            WHEN 'win' THEN
              (v_reconciliation ->> 'outcomeStatus') <> 'complete'
              OR entry.value -> 'finishPosition' IS NULL
              OR (score.value ->> 'actual')::boolean IS DISTINCT FROM
                ((entry.value ->> 'finishPosition')::integer = 1)
            WHEN 'blue_star' THEN
              (v_reconciliation ->> 'starDataStatus') <> 'complete'
              OR jsonb_typeof(entry.value -> 'blueStar') IS DISTINCT FROM 'boolean'
              OR (score.value ->> 'actual')::boolean IS DISTINCT FROM
                (entry.value ->> 'blueStar')::boolean
            WHEN 'yellow_star' THEN
              (v_reconciliation ->> 'starDataStatus') <> 'complete'
              OR (v_snapshot_body -> 'context' ->> 'gateCount')::integer <= 3
              OR jsonb_typeof(entry.value -> 'goldStar') IS DISTINCT FROM 'boolean'
              OR (score.value ->> 'actual')::boolean IS DISTINCT FROM
                (entry.value ->> 'goldStar')::boolean
            ELSE true
          END)))
    OR ((v_reconciliation ->> 'recordStatus') = 'reconciled' AND (
      (v_reconciliation ->> 'outcomeStatus') <> 'complete'
      OR (v_reconciliation ->> 'starDataStatus') <> 'complete'
      OR jsonb_array_length(v_reconciliation -> 'issues') <> 0
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_reconciliation -> 'scores') score(value)
        JOIN jsonb_array_elements(v_snapshot_body -> 'predictions') prediction(value)
          ON prediction.value ->> 'coreId' = score.value ->> 'coreId'
          AND prediction.value ->> 'target' = score.value ->> 'target'
        WHERE CASE
          WHEN prediction.value ->> 'status' = 'available'
            AND score.value ->> 'target' <> 'place'
          THEN score.value ->> 'scoringStatus' <> 'scored'
            OR score.value ->> 'reason' <> 'prediction_available'
          WHEN prediction.value ->> 'status' = 'available'
            AND score.value ->> 'target' = 'place'
          THEN score.value ->> 'scoringStatus' <> 'unscored'
            OR score.value ->> 'reason' <> 'target_definition_unresolved'
          WHEN prediction.value ->> 'status' = 'unavailable'
          THEN score.value ->> 'scoringStatus' <> 'unscored'
            OR score.value ->> 'reason' <> 'prediction_unavailable'
          WHEN prediction.value ->> 'status' = 'review_required'
          THEN score.value ->> 'scoringStatus' <> 'unscored'
            OR score.value ->> 'reason' <> 'prediction_review_required'
          WHEN prediction.value ->> 'status' = 'not_applicable'
          THEN score.value ->> 'scoringStatus' <> 'unscored'
            OR score.value ->> 'reason' <> 'target_not_applicable'
          ELSE true
        END)))
  THEN RAISE EXCEPTION 'Open Race prediction reconciliation does not match its frozen source'; END IF;

  SELECT reconciliation.* INTO v_existing
  FROM dna.open_race_prediction_reconciliation reconciliation
  WHERE reconciliation.owner_id = p_owner_id
    AND reconciliation.reconciliation_id = v_reconciliation ->> 'reconciliationId'
    AND reconciliation.revision = (v_reconciliation ->> 'revision')::integer;
  IF FOUND THEN
    IF (v_existing.reconciliation_json::jsonb -> 'reconciliation')
      IS NOT DISTINCT FROM v_reconciliation
      THEN RETURN 'unchanged'; END IF;
    RETURN 'source_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM dna.open_race_prediction_reconciliation reconciliation
    WHERE reconciliation.owner_id = p_owner_id
      AND reconciliation.snapshot_id = v_snapshot.snapshot_id
      AND reconciliation.source_evidence_id = v_reconciliation ->> 'sourceEvidenceId')
  THEN RETURN 'source_changed'; END IF;

  IF (v_reconciliation ->> 'revision')::integer = 0 THEN
    IF (v_reconciliation -> 'correctsSourceEvidenceId') IS DISTINCT FROM 'null'::jsonb
      OR jsonb_array_length(v_reconciliation -> 'correctionHistory') <> 0
      OR EXISTS (SELECT 1 FROM dna.open_race_prediction_reconciliation reconciliation
        WHERE reconciliation.owner_id = p_owner_id
          AND reconciliation.snapshot_id = v_snapshot.snapshot_id)
    THEN RETURN 'source_changed'; END IF;
  ELSE
    SELECT reconciliation.* INTO v_previous
    FROM dna.open_race_prediction_reconciliation reconciliation
    WHERE reconciliation.owner_id = p_owner_id
      AND reconciliation.snapshot_id = v_snapshot.snapshot_id
    ORDER BY reconciliation.revision DESC LIMIT 1 FOR SHARE;
    IF NOT FOUND
      OR v_previous.reconciliation_id IS DISTINCT FROM v_reconciliation ->> 'reconciliationId'
      OR v_previous.revision + 1 IS DISTINCT FROM (v_reconciliation ->> 'revision')::integer
      OR v_previous.source_evidence_id IS DISTINCT FROM
        v_reconciliation ->> 'correctsSourceEvidenceId'
      OR (v_reconciliation ->> 'acceptedAt')::timestamptz < v_previous.accepted_at
    THEN RETURN 'source_changed'; END IF;
    v_previous_reconciliation := v_previous.reconciliation_json::jsonb -> 'reconciliation';
    v_expected_history := (v_previous_reconciliation -> 'correctionHistory') ||
      jsonb_build_array(jsonb_build_object(
        'revision', v_previous.revision,
        'sourceEvidenceId', v_previous.source_evidence_id,
        'sourceVersion', v_previous.source_version,
        'acceptedAt', v_previous_reconciliation ->> 'acceptedAt'));
    IF (v_reconciliation -> 'correctionHistory') IS DISTINCT FROM v_expected_history
    THEN RETURN 'source_changed'; END IF;
  END IF;

  INSERT INTO dna.open_race_prediction_reconciliation (
    owner_id, reconciliation_id, revision, snapshot_id, event_id,
    source_evidence_id, source_version, accepted_at, event_completed_at,
    corrects_source_evidence_id, record_status, history_update_allowed,
    published_at, reconciliation_sha256, reconciliation_json)
  VALUES (p_owner_id, v_reconciliation ->> 'reconciliationId',
    (v_reconciliation ->> 'revision')::integer, v_snapshot.snapshot_id,
    v_snapshot.event_id, v_reconciliation ->> 'sourceEvidenceId',
    v_reconciliation ->> 'sourceVersion',
    (v_reconciliation ->> 'acceptedAt')::timestamptz,
    (v_reconciliation ->> 'eventCompletedAt')::timestamptz,
    v_reconciliation ->> 'correctsSourceEvidenceId',
    v_reconciliation ->> 'recordStatus',
    (v_reconciliation ->> 'historyUpdateAllowed')::boolean,
    (v_envelope ->> 'publishedAt')::timestamptz,
    p_reconciliation_sha256, p_reconciliation_json);
  RETURN 'published';
END
$function$;

REVOKE ALL ON TABLE dna.open_race_prediction_reconciliation FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_open_race_prediction_reconciliations(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_open_race_prediction_reconciliation(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_open_race_prediction_reconciliations(uuid,integer) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_open_race_prediction_reconciliation(uuid,text,text,text) TO dna_app_runtime;

COMMIT;
