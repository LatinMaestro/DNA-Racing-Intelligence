BEGIN;

CREATE TABLE dna.dna_open_lab_finished_race_incremental_window_receipt (
  owner_id uuid NOT NULL,
  cycle_id character(64) NOT NULL,
  first_attempt_number smallint NOT NULL CHECK (first_attempt_number BETWEEN 1 AND 32),
  window_key character(64) NOT NULL CHECK (window_key ~ '^[a-f0-9]{64}$'),
  content_sha256 character(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  document_count integer NOT NULL CHECK (document_count BETWEEN 0 AND 199),
  manifest_object_key text NOT NULL,
  manifest_body_sha256 character(64) NOT NULL
    CHECK (manifest_body_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_byte_length bigint NOT NULL CHECK (manifest_byte_length > 0),
  window_start_at timestamptz NOT NULL,
  window_end_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, cycle_id, window_key),
  UNIQUE (owner_id, manifest_object_key),
  FOREIGN KEY (owner_id, cycle_id)
    REFERENCES dna.dna_open_lab_finished_race_incremental_cycle(owner_id, cycle_id)
    ON DELETE RESTRICT,
  CHECK (window_start_at < window_end_at),
  CHECK (length(manifest_object_key) BETWEEN 1 AND 4096),
  CHECK (manifest_object_key !~ '[[:cntrl:]]')
);

ALTER TABLE dna.dna_open_lab_finished_race_incremental_window_receipt
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_finished_race_incremental_window_receipt
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_finished_race_incremental_window_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.save_dna_open_lab_finished_race_incremental_progress(
  p_owner_id uuid,
  p_expected_revision bigint,
  p_cycle jsonb,
  p_publication jsonb
)
RETURNS TABLE (revision bigint, cycle jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dna_open_lab_finished_race_incremental_attempt%ROWTYPE;
  v_existing_receipt dna.dna_open_lab_finished_race_incremental_window_receipt%ROWTYPE;
  v_cycle_id character(64);
  v_attempt smallint;
  v_old_checkpoint jsonb;
  v_new_checkpoint jsonb;
  v_old_pending jsonb;
  v_new_pending jsonb;
  v_parent jsonb;
  v_left jsonb;
  v_right jsonb;
  v_window jsonb;
  v_receipt jsonb;
  v_window_key text;
  v_content_sha256 text;
  v_document_count integer;
  v_manifest_object_key text;
  v_manifest_body_sha256 text;
  v_manifest_byte_length bigint;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_saved_revision bigint;
  v_saved_cycle jsonb;
  v_key_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped finished-race incremental progress denied';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'finished-race incremental progress revision is invalid';
  END IF;
  PERFORM dna.validate_dna_open_lab_finished_race_incremental_cycle(p_cycle);
  IF p_cycle ->> 'status' <> 'running' THEN
    RAISE EXCEPTION 'finished-race incremental progress requires running status';
  END IF;
  v_cycle_id := (p_cycle ->> 'cycleId')::character(64);
  v_attempt := (p_cycle ->> 'attemptNumber')::smallint;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':finished-race-incremental:' || v_cycle_id::text, 0
  ));
  SELECT stored.* INTO v_existing
  FROM dna.dna_open_lab_finished_race_incremental_attempt stored
  WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
    AND stored.attempt_number = v_attempt
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finished-race incremental progress attempt is unavailable';
  END IF;

  IF v_existing.revision <> p_expected_revision THEN
    IF v_existing.revision = p_expected_revision + 1
       AND v_existing.cycle = p_cycle THEN
      IF p_publication IS NULL THEN
        RETURN QUERY SELECT v_existing.revision, v_existing.cycle;
        RETURN;
      END IF;
      v_window_key := p_publication -> 'receipt' ->> 'windowKey';
      SELECT stored.* INTO v_existing_receipt
      FROM dna.dna_open_lab_finished_race_incremental_window_receipt stored
      WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
        AND stored.window_key = v_window_key::character(64);
      IF FOUND
         AND v_existing_receipt.content_sha256::text =
           p_publication -> 'receipt' ->> 'contentSha256'
         AND v_existing_receipt.document_count::text =
           p_publication -> 'receipt' ->> 'documentCount'
         AND v_existing_receipt.manifest_object_key =
           p_publication -> 'receipt' ->> 'manifestObjectKey'
         AND v_existing_receipt.manifest_body_sha256::text =
           p_publication -> 'receipt' ->> 'manifestBodySha256'
         AND v_existing_receipt.manifest_byte_length::text =
           p_publication -> 'receipt' ->> 'manifestByteLength'
         AND v_existing_receipt.window_start_at =
           (p_publication -> 'window' ->> 'startTime')::timestamptz
         AND v_existing_receipt.window_end_at =
           (p_publication -> 'window' ->> 'endTime')::timestamptz THEN
        RETURN QUERY SELECT v_existing.revision, v_existing.cycle;
        RETURN;
      END IF;
      RAISE EXCEPTION 'finished-race incremental publication replay conflict';
    END IF;
    RAISE EXCEPTION 'finished-race incremental progress revision conflict';
  END IF;
  IF v_existing.status <> 'running' THEN
    RAISE EXCEPTION 'finished-race incremental progress attempt is not running';
  END IF;

  v_old_checkpoint := v_existing.cycle -> 'checkpoint';
  v_new_checkpoint := p_cycle -> 'checkpoint';
  v_old_pending := v_old_checkpoint -> 'pendingWindows';
  v_new_pending := v_new_checkpoint -> 'pendingWindows';
  IF jsonb_array_length(v_old_pending) < 1
     OR v_old_checkpoint -> 'rootWindow' <> v_new_checkpoint -> 'rootWindow'
     OR v_old_checkpoint -> 'minimumWindowMilliseconds' <>
        v_new_checkpoint -> 'minimumWindowMilliseconds'
     OR (v_old_checkpoint - 'pendingWindows' - 'completedWindowCount'
         - 'splitCount' - 'successfulFinishedRaceRequestCount'
         - 'raceDocumentRequestCount' - 'publishedWindowDocumentCount') <>
        (v_new_checkpoint - 'pendingWindows' - 'completedWindowCount'
         - 'splitCount' - 'successfulFinishedRaceRequestCount'
         - 'raceDocumentRequestCount' - 'publishedWindowDocumentCount') THEN
    RAISE EXCEPTION 'finished-race incremental checkpoint authority changed';
  END IF;
  v_parent := v_old_pending -> 0;

  IF p_publication IS NULL THEN
    IF jsonb_array_length(v_new_pending) <> jsonb_array_length(v_old_pending) + 1
       OR (v_new_pending - 0 - 0) <> (v_old_pending - 0)
       OR (v_new_checkpoint ->> 'completedWindowCount')::bigint <>
          (v_old_checkpoint ->> 'completedWindowCount')::bigint
       OR (v_new_checkpoint ->> 'splitCount')::bigint <>
          (v_old_checkpoint ->> 'splitCount')::bigint + 1
       OR (v_new_checkpoint ->> 'successfulFinishedRaceRequestCount')::bigint <>
          (v_old_checkpoint ->> 'successfulFinishedRaceRequestCount')::bigint + 1
       OR v_new_checkpoint -> 'raceDocumentRequestCount' <>
          v_old_checkpoint -> 'raceDocumentRequestCount'
       OR v_new_checkpoint -> 'publishedWindowDocumentCount' <>
          v_old_checkpoint -> 'publishedWindowDocumentCount' THEN
      RAISE EXCEPTION 'finished-race incremental split transition is invalid';
    END IF;
    v_left := v_new_pending -> 0;
    v_right := v_new_pending -> 1;
    IF (v_left ->> 'startTime')::timestamptz <>
         (v_parent ->> 'startTime')::timestamptz
       OR (v_left ->> 'endTime')::timestamptz <>
          (v_right ->> 'startTime')::timestamptz
       OR (v_right ->> 'endTime')::timestamptz <>
          (v_parent ->> 'endTime')::timestamptz
       OR (v_left ->> 'startTime')::timestamptz >=
          (v_left ->> 'endTime')::timestamptz
       OR (v_right ->> 'startTime')::timestamptz >=
          (v_right ->> 'endTime')::timestamptz THEN
      RAISE EXCEPTION 'finished-race incremental split windows are invalid';
    END IF;
  ELSE
    IF jsonb_typeof(p_publication) <> 'object' THEN
      RAISE EXCEPTION 'finished-race incremental publication is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(p_publication);
    IF v_key_count <> 2 OR NOT (p_publication ?& ARRAY['window', 'receipt']) THEN
      RAISE EXCEPTION 'finished-race incremental publication fields are invalid';
    END IF;
    v_window := p_publication -> 'window';
    v_receipt := p_publication -> 'receipt';
    IF jsonb_typeof(v_window) <> 'object' OR jsonb_typeof(v_receipt) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_window)) <> 2
       OR NOT (v_window ?& ARRAY['startTime', 'endTime'])
       OR (SELECT count(*) FROM jsonb_object_keys(v_receipt)) <> 6
       OR NOT (v_receipt ?& ARRAY[
         'windowKey', 'contentSha256', 'documentCount', 'manifestObjectKey',
         'manifestBodySha256', 'manifestByteLength'
       ]) THEN
      RAISE EXCEPTION 'finished-race incremental publication values are invalid';
    END IF;
    v_window_key := v_receipt ->> 'windowKey';
    v_content_sha256 := v_receipt ->> 'contentSha256';
    v_manifest_object_key := v_receipt ->> 'manifestObjectKey';
    v_manifest_body_sha256 := v_receipt ->> 'manifestBodySha256';
    IF jsonb_typeof(v_receipt -> 'documentCount') <> 'number'
       OR v_receipt ->> 'documentCount' !~ '^[0-9]+$'
       OR jsonb_typeof(v_receipt -> 'manifestByteLength') <> 'number'
       OR v_receipt ->> 'manifestByteLength' !~ '^[0-9]+$'
       OR v_window_key !~ '^[a-f0-9]{64}$'
       OR v_content_sha256 !~ '^[a-f0-9]{64}$'
       OR v_manifest_body_sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'finished-race incremental publication receipt is invalid';
    END IF;
    v_document_count := (v_receipt ->> 'documentCount')::integer;
    v_manifest_byte_length := (v_receipt ->> 'manifestByteLength')::bigint;
    IF v_document_count NOT BETWEEN 0 AND 199
       OR v_manifest_byte_length < 1
       OR length(v_manifest_object_key) NOT BETWEEN 1 AND 4096
       OR v_manifest_object_key ~ '[[:cntrl:]]'
       OR v_manifest_object_key !~ (
         '^dna-open-lab/v1/[a-f0-9]{64}/races/finished-windows/'
         || v_window_key || '\.json$'
       ) THEN
      RAISE EXCEPTION 'finished-race incremental publication receipt is out of bounds';
    END IF;
    BEGIN
      v_window_start := (v_window ->> 'startTime')::timestamptz;
      v_window_end := (v_window ->> 'endTime')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'finished-race incremental publication timestamps are invalid';
    END;
    IF v_window_start <> (v_parent ->> 'startTime')::timestamptz
       OR v_window_end <> (v_parent ->> 'endTime')::timestamptz
       OR v_new_pending <> (v_old_pending - 0)
       OR v_new_checkpoint -> 'splitCount' <> v_old_checkpoint -> 'splitCount'
       OR (v_new_checkpoint ->> 'completedWindowCount')::bigint <>
          (v_old_checkpoint ->> 'completedWindowCount')::bigint + 1
       OR (v_new_checkpoint ->> 'successfulFinishedRaceRequestCount')::bigint <>
          (v_old_checkpoint ->> 'successfulFinishedRaceRequestCount')::bigint + 1
       OR (v_new_checkpoint ->> 'raceDocumentRequestCount')::bigint <>
          (v_old_checkpoint ->> 'raceDocumentRequestCount')::bigint
            + ((v_document_count + 19) / 20)
       OR (v_new_checkpoint ->> 'publishedWindowDocumentCount')::bigint <>
          (v_old_checkpoint ->> 'publishedWindowDocumentCount')::bigint
            + v_document_count THEN
      RAISE EXCEPTION 'finished-race incremental publication transition is invalid';
    END IF;
  END IF;

  SELECT saved.revision, saved.cycle INTO v_saved_revision, v_saved_cycle
  FROM dna.save_dna_open_lab_finished_race_incremental_cycle(
    p_owner_id, p_expected_revision, p_cycle
  ) saved;

  IF p_publication IS NOT NULL THEN
    SELECT stored.* INTO v_existing_receipt
    FROM dna.dna_open_lab_finished_race_incremental_window_receipt stored
    WHERE stored.owner_id = p_owner_id AND stored.cycle_id = v_cycle_id
      AND stored.window_key = v_window_key::character(64)
    FOR UPDATE;
    IF FOUND THEN
      IF v_existing_receipt.content_sha256::text <> v_content_sha256
         OR v_existing_receipt.document_count <> v_document_count
         OR v_existing_receipt.manifest_object_key <> v_manifest_object_key
         OR v_existing_receipt.manifest_body_sha256::text <> v_manifest_body_sha256
         OR v_existing_receipt.manifest_byte_length <> v_manifest_byte_length
         OR v_existing_receipt.window_start_at <> v_window_start
         OR v_existing_receipt.window_end_at <> v_window_end THEN
        RAISE EXCEPTION 'finished-race incremental publication receipt conflict';
      END IF;
    ELSE
      INSERT INTO dna.dna_open_lab_finished_race_incremental_window_receipt (
        owner_id, cycle_id, first_attempt_number, window_key, content_sha256,
        document_count, manifest_object_key, manifest_body_sha256,
        manifest_byte_length, window_start_at, window_end_at
      ) VALUES (
        p_owner_id, v_cycle_id, v_attempt, v_window_key, v_content_sha256,
        v_document_count, v_manifest_object_key, v_manifest_body_sha256,
        v_manifest_byte_length, v_window_start, v_window_end
      );
    END IF;
  END IF;
  RETURN QUERY SELECT v_saved_revision, v_saved_cycle;
END
$function$;

REVOKE ALL ON TABLE
  dna.dna_open_lab_finished_race_incremental_window_receipt
FROM PUBLIC;
REVOKE ALL ON TABLE
  dna.dna_open_lab_finished_race_incremental_window_receipt
FROM dna_app_runtime;
REVOKE ALL ON FUNCTION
  dna.save_dna_open_lab_finished_race_incremental_progress(uuid,bigint,jsonb,jsonb)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  dna.save_dna_open_lab_finished_race_incremental_progress(uuid,bigint,jsonb,jsonb)
TO dna_app_runtime;

COMMIT;
