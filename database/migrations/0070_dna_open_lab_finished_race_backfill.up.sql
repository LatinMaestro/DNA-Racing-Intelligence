BEGIN;

CREATE TABLE dna.dna_open_lab_finished_race_backfill_checkpoint (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  checkpoint jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (jsonb_typeof(checkpoint) = 'object')
);

CREATE TABLE dna.dna_open_lab_finished_race_window_receipt (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  window_key character(64) NOT NULL,
  content_sha256 character(64) NOT NULL,
  document_count integer NOT NULL CHECK (document_count BETWEEN 0 AND 199),
  manifest_object_key text NOT NULL,
  manifest_body_sha256 character(64) NOT NULL,
  manifest_byte_length bigint NOT NULL CHECK (manifest_byte_length > 0),
  window_start_at timestamptz NOT NULL,
  window_end_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, window_key),
  UNIQUE (owner_id, manifest_object_key),
  CHECK (window_key ~ '^[a-f0-9]{64}$'),
  CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (manifest_body_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (window_start_at <= window_end_at),
  CHECK (length(manifest_object_key) BETWEEN 1 AND 4096),
  CHECK (manifest_object_key !~ '[[:cntrl:]]')
);

ALTER TABLE dna.dna_open_lab_finished_race_backfill_checkpoint
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_finished_race_backfill_checkpoint
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_finished_race_backfill_checkpoint
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_finished_race_window_receipt
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_finished_race_window_receipt
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_finished_race_window_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.validate_dna_open_lab_finished_race_backfill_checkpoint(
  p_checkpoint jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_key_count integer;
  v_root jsonb;
  v_root_start timestamptz;
  v_root_end timestamptz;
  v_window jsonb;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_pending_count integer;
  v_numeric_key text;
  v_numeric_value numeric;
BEGIN
  IF jsonb_typeof(p_checkpoint) <> 'object' THEN
    RAISE EXCEPTION 'finished-race checkpoint must be an object';
  END IF;
  SELECT count(*)::integer INTO v_key_count
  FROM jsonb_object_keys(p_checkpoint);
  IF v_key_count <> 9 OR NOT (
    p_checkpoint ? 'version'
    AND p_checkpoint ? 'rootWindow'
    AND p_checkpoint ? 'pendingWindows'
    AND p_checkpoint ? 'minimumWindowMilliseconds'
    AND p_checkpoint ? 'completedWindowCount'
    AND p_checkpoint ? 'splitCount'
    AND p_checkpoint ? 'successfulFinishedRaceRequestCount'
    AND p_checkpoint ? 'raceDocumentRequestCount'
    AND p_checkpoint ? 'publishedWindowDocumentCount'
  ) THEN
    RAISE EXCEPTION 'finished-race checkpoint fields are invalid';
  END IF;
  IF jsonb_typeof(p_checkpoint -> 'version') <> 'number'
     OR p_checkpoint ->> 'version' <> '1' THEN
    RAISE EXCEPTION 'finished-race checkpoint version is unsupported';
  END IF;

  v_root := p_checkpoint -> 'rootWindow';
  IF jsonb_typeof(v_root) <> 'object' THEN
    RAISE EXCEPTION 'finished-race root window is invalid';
  END IF;
  SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_root);
  IF v_key_count <> 2 OR NOT (v_root ? 'startTime' AND v_root ? 'endTime')
     OR jsonb_typeof(v_root -> 'startTime') <> 'string'
     OR jsonb_typeof(v_root -> 'endTime') <> 'string' THEN
    RAISE EXCEPTION 'finished-race root window fields are invalid';
  END IF;
  BEGIN
    v_root_start := (v_root ->> 'startTime')::timestamptz;
    v_root_end := (v_root ->> 'endTime')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'finished-race root window timestamps are invalid';
  END;
  IF v_root_start > v_root_end THEN
    RAISE EXCEPTION 'finished-race root window chronology is invalid';
  END IF;

  IF jsonb_typeof(p_checkpoint -> 'pendingWindows') <> 'array' THEN
    RAISE EXCEPTION 'finished-race pending windows must be an array';
  END IF;
  v_pending_count := jsonb_array_length(p_checkpoint -> 'pendingWindows');
  IF v_pending_count > 128 THEN
    RAISE EXCEPTION 'finished-race pending window bound exceeded';
  END IF;
  IF (
    SELECT count(*) FROM (
      SELECT DISTINCT value
      FROM jsonb_array_elements(p_checkpoint -> 'pendingWindows')
    ) unique_windows
  ) <> v_pending_count THEN
    RAISE EXCEPTION 'finished-race pending windows contain duplicates';
  END IF;
  FOR v_window IN
    SELECT value FROM jsonb_array_elements(p_checkpoint -> 'pendingWindows')
  LOOP
    IF jsonb_typeof(v_window) <> 'object' THEN
      RAISE EXCEPTION 'finished-race pending window is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count
    FROM jsonb_object_keys(v_window);
    IF v_key_count <> 2 OR NOT (
      v_window ? 'startTime' AND v_window ? 'endTime'
    ) OR jsonb_typeof(v_window -> 'startTime') <> 'string'
      OR jsonb_typeof(v_window -> 'endTime') <> 'string' THEN
      RAISE EXCEPTION 'finished-race pending window fields are invalid';
    END IF;
    BEGIN
      v_window_start := (v_window ->> 'startTime')::timestamptz;
      v_window_end := (v_window ->> 'endTime')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'finished-race pending window timestamps are invalid';
    END;
    IF v_window_start > v_window_end
       OR v_window_start < v_root_start OR v_window_end > v_root_end THEN
      RAISE EXCEPTION 'finished-race pending window bounds are invalid';
    END IF;
  END LOOP;

  FOREACH v_numeric_key IN ARRAY ARRAY[
    'minimumWindowMilliseconds', 'completedWindowCount', 'splitCount',
    'successfulFinishedRaceRequestCount', 'raceDocumentRequestCount',
    'publishedWindowDocumentCount'
  ]
  LOOP
    IF jsonb_typeof(p_checkpoint -> v_numeric_key) <> 'number'
       OR p_checkpoint ->> v_numeric_key !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'finished-race checkpoint counter % is invalid',
        v_numeric_key;
    END IF;
    v_numeric_value := (p_checkpoint ->> v_numeric_key)::numeric;
    IF v_numeric_value > 9007199254740991
       OR (v_numeric_key = 'minimumWindowMilliseconds' AND v_numeric_value < 1)
       OR (v_numeric_key <> 'minimumWindowMilliseconds' AND v_numeric_value < 0) THEN
      RAISE EXCEPTION 'finished-race checkpoint counter % is out of bounds',
        v_numeric_key;
    END IF;
  END LOOP;
END
$function$;

CREATE FUNCTION dna.save_dna_open_lab_finished_race_backfill_checkpoint(
  p_owner_id uuid,
  p_expected_revision bigint,
  p_checkpoint jsonb,
  p_publication jsonb
)
RETURNS TABLE (revision bigint, checkpoint jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.dna_open_lab_finished_race_backfill_checkpoint%ROWTYPE;
  v_existing_receipt dna.dna_open_lab_finished_race_window_receipt%ROWTYPE;
  v_old_pending jsonb;
  v_new_pending jsonb;
  v_parent jsonb;
  v_left jsonb;
  v_right jsonb;
  v_receipt jsonb;
  v_window jsonb;
  v_window_key text;
  v_content_sha256 text;
  v_document_count integer;
  v_manifest_object_key text;
  v_manifest_body_sha256 text;
  v_manifest_byte_length bigint;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_next_revision bigint;
  v_key_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped finished-race checkpoint denied';
  END IF;
  IF p_expected_revision IS NOT NULL AND p_expected_revision < 1 THEN
    RAISE EXCEPTION 'finished-race expected revision is invalid';
  END IF;
  PERFORM dna.validate_dna_open_lab_finished_race_backfill_checkpoint(
    p_checkpoint
  );

  IF p_publication IS NOT NULL THEN
    IF jsonb_typeof(p_publication) <> 'object' THEN
      RAISE EXCEPTION 'finished-race publication binding is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count
    FROM jsonb_object_keys(p_publication);
    IF v_key_count <> 2 OR NOT (
      p_publication ? 'window' AND p_publication ? 'receipt'
    ) THEN
      RAISE EXCEPTION 'finished-race publication binding fields are invalid';
    END IF;
    v_window := p_publication -> 'window';
    v_receipt := p_publication -> 'receipt';
    IF jsonb_typeof(v_window) <> 'object' OR jsonb_typeof(v_receipt) <> 'object' THEN
      RAISE EXCEPTION 'finished-race publication binding values are invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_window);
    IF v_key_count <> 2 OR NOT (v_window ? 'startTime' AND v_window ? 'endTime')
       OR jsonb_typeof(v_window -> 'startTime') <> 'string'
       OR jsonb_typeof(v_window -> 'endTime') <> 'string' THEN
      RAISE EXCEPTION 'finished-race publication window is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_receipt);
    IF v_key_count <> 6 OR NOT (
      v_receipt ? 'windowKey' AND v_receipt ? 'contentSha256'
      AND v_receipt ? 'documentCount' AND v_receipt ? 'manifestObjectKey'
      AND v_receipt ? 'manifestBodySha256'
      AND v_receipt ? 'manifestByteLength'
    ) THEN
      RAISE EXCEPTION 'finished-race publication receipt fields are invalid';
    END IF;
    v_window_key := v_receipt ->> 'windowKey';
    v_content_sha256 := v_receipt ->> 'contentSha256';
    v_manifest_object_key := v_receipt ->> 'manifestObjectKey';
    v_manifest_body_sha256 := v_receipt ->> 'manifestBodySha256';
    IF jsonb_typeof(v_receipt -> 'windowKey') <> 'string'
       OR jsonb_typeof(v_receipt -> 'contentSha256') <> 'string'
       OR jsonb_typeof(v_receipt -> 'manifestObjectKey') <> 'string'
       OR jsonb_typeof(v_receipt -> 'manifestBodySha256') <> 'string'
       OR jsonb_typeof(v_receipt -> 'documentCount') <> 'number'
       OR v_receipt ->> 'documentCount' !~ '^[0-9]+$'
       OR jsonb_typeof(v_receipt -> 'manifestByteLength') <> 'number'
       OR v_receipt ->> 'manifestByteLength' !~ '^[0-9]+$'
       OR v_window_key !~ '^[a-f0-9]{64}$'
       OR v_content_sha256 !~ '^[a-f0-9]{64}$'
       OR v_manifest_body_sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'finished-race publication receipt is invalid';
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
      RAISE EXCEPTION 'finished-race publication receipt is out of bounds';
    END IF;
    BEGIN
      v_window_start := (v_window ->> 'startTime')::timestamptz;
      v_window_end := (v_window ->> 'endTime')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'finished-race publication window timestamps are invalid';
    END;
    IF v_window_start > v_window_end THEN
      RAISE EXCEPTION 'finished-race publication window chronology is invalid';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':dna-open-lab-finished-race-backfill', 0)
  );
  SELECT stored.* INTO v_existing
  FROM dna.dna_open_lab_finished_race_backfill_checkpoint stored
  WHERE stored.owner_id = p_owner_id
  FOR UPDATE;

  IF FOUND AND (
    p_expected_revision IS NULL OR v_existing.revision <> p_expected_revision
  ) THEN
    IF v_existing.checkpoint = p_checkpoint
       AND v_existing.revision = COALESCE(p_expected_revision, 0) + 1 THEN
      IF p_publication IS NOT NULL THEN
        SELECT receipt.* INTO v_existing_receipt
        FROM dna.dna_open_lab_finished_race_window_receipt receipt
        WHERE receipt.owner_id = p_owner_id
          AND receipt.window_key = v_window_key;
        IF NOT FOUND
           OR v_existing_receipt.content_sha256 <> v_content_sha256
           OR v_existing_receipt.document_count <> v_document_count
           OR v_existing_receipt.manifest_object_key <> v_manifest_object_key
           OR v_existing_receipt.manifest_body_sha256 <> v_manifest_body_sha256
           OR v_existing_receipt.manifest_byte_length <> v_manifest_byte_length
           OR v_existing_receipt.window_start_at <> v_window_start
           OR v_existing_receipt.window_end_at <> v_window_end THEN
          RAISE EXCEPTION 'finished-race publication replay conflict';
        END IF;
      END IF;
      RETURN QUERY SELECT v_existing.revision, v_existing.checkpoint;
      RETURN;
    END IF;
    RAISE EXCEPTION 'finished-race checkpoint revision conflict';
  END IF;

  IF NOT FOUND THEN
    IF p_expected_revision IS NOT NULL OR p_publication IS NOT NULL
       OR (p_checkpoint ->> 'completedWindowCount')::bigint <> 0
       OR (p_checkpoint ->> 'splitCount')::bigint <> 0
       OR (p_checkpoint ->> 'successfulFinishedRaceRequestCount')::bigint <> 0
       OR (p_checkpoint ->> 'raceDocumentRequestCount')::bigint <> 0
       OR (p_checkpoint ->> 'publishedWindowDocumentCount')::bigint <> 0
       OR jsonb_array_length(p_checkpoint -> 'pendingWindows') <> 1
       OR (p_checkpoint -> 'pendingWindows' -> 0) <>
          (p_checkpoint -> 'rootWindow') THEN
      RAISE EXCEPTION 'finished-race initial checkpoint is invalid';
    END IF;
    INSERT INTO dna.dna_open_lab_finished_race_backfill_checkpoint (
      owner_id, revision, checkpoint
    ) VALUES (p_owner_id, 1, p_checkpoint);
    RETURN QUERY SELECT 1::bigint, p_checkpoint;
    RETURN;
  END IF;

  v_old_pending := v_existing.checkpoint -> 'pendingWindows';
  v_new_pending := p_checkpoint -> 'pendingWindows';
  IF jsonb_array_length(v_old_pending) < 1
     OR p_checkpoint -> 'rootWindow' <> v_existing.checkpoint -> 'rootWindow'
     OR p_checkpoint -> 'minimumWindowMilliseconds' <>
        v_existing.checkpoint -> 'minimumWindowMilliseconds' THEN
    RAISE EXCEPTION 'finished-race checkpoint authority cannot change';
  END IF;
  v_parent := v_old_pending -> 0;

  IF p_publication IS NULL THEN
    IF jsonb_array_length(v_new_pending) <> jsonb_array_length(v_old_pending) + 1
       OR (v_new_pending - 0 - 0) <> (v_old_pending - 0)
       OR (p_checkpoint ->> 'completedWindowCount')::bigint <>
          (v_existing.checkpoint ->> 'completedWindowCount')::bigint
       OR (p_checkpoint ->> 'splitCount')::bigint <>
          (v_existing.checkpoint ->> 'splitCount')::bigint + 1
       OR (p_checkpoint ->> 'successfulFinishedRaceRequestCount')::bigint <>
          (v_existing.checkpoint ->> 'successfulFinishedRaceRequestCount')::bigint + 1
       OR (p_checkpoint ->> 'raceDocumentRequestCount')::bigint <>
          (v_existing.checkpoint ->> 'raceDocumentRequestCount')::bigint
       OR (p_checkpoint ->> 'publishedWindowDocumentCount')::bigint <>
          (v_existing.checkpoint ->> 'publishedWindowDocumentCount')::bigint THEN
      RAISE EXCEPTION 'finished-race split transition is invalid';
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
      RAISE EXCEPTION 'finished-race split windows are invalid';
    END IF;
  ELSE
    IF v_window_start <> (v_parent ->> 'startTime')::timestamptz
       OR v_window_end <> (v_parent ->> 'endTime')::timestamptz
       OR v_new_pending <> (v_old_pending - 0)
       OR p_checkpoint -> 'splitCount' <>
          v_existing.checkpoint -> 'splitCount'
       OR (p_checkpoint ->> 'completedWindowCount')::bigint <>
          (v_existing.checkpoint ->> 'completedWindowCount')::bigint + 1
       OR (p_checkpoint ->> 'successfulFinishedRaceRequestCount')::bigint <>
          (v_existing.checkpoint ->> 'successfulFinishedRaceRequestCount')::bigint + 1
       OR (p_checkpoint ->> 'raceDocumentRequestCount')::bigint <>
          (v_existing.checkpoint ->> 'raceDocumentRequestCount')::bigint
            + ((v_document_count + 19) / 20)
       OR (p_checkpoint ->> 'publishedWindowDocumentCount')::bigint <>
          (v_existing.checkpoint ->> 'publishedWindowDocumentCount')::bigint
            + v_document_count THEN
      RAISE EXCEPTION 'finished-race publication transition is invalid';
    END IF;

    SELECT receipt.* INTO v_existing_receipt
    FROM dna.dna_open_lab_finished_race_window_receipt receipt
    WHERE receipt.owner_id = p_owner_id AND receipt.window_key = v_window_key
    FOR UPDATE;
    IF FOUND THEN
      IF v_existing_receipt.content_sha256 <> v_content_sha256
         OR v_existing_receipt.document_count <> v_document_count
         OR v_existing_receipt.manifest_object_key <> v_manifest_object_key
         OR v_existing_receipt.manifest_body_sha256 <> v_manifest_body_sha256
         OR v_existing_receipt.manifest_byte_length <> v_manifest_byte_length
         OR v_existing_receipt.window_start_at <> v_window_start
         OR v_existing_receipt.window_end_at <> v_window_end THEN
        RAISE EXCEPTION 'finished-race publication receipt conflict';
      END IF;
    ELSE
      INSERT INTO dna.dna_open_lab_finished_race_window_receipt (
        owner_id, window_key, content_sha256, document_count,
        manifest_object_key, manifest_body_sha256, manifest_byte_length,
        window_start_at, window_end_at
      ) VALUES (
        p_owner_id, v_window_key, v_content_sha256, v_document_count,
        v_manifest_object_key, v_manifest_body_sha256, v_manifest_byte_length,
        v_window_start, v_window_end
      );
    END IF;
  END IF;

  v_next_revision := v_existing.revision + 1;
  UPDATE dna.dna_open_lab_finished_race_backfill_checkpoint
  SET revision = v_next_revision, checkpoint = p_checkpoint,
      updated_at = clock_timestamp()
  WHERE owner_id = p_owner_id;
  RETURN QUERY SELECT v_next_revision, p_checkpoint;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_finished_race_backfill_checkpoint(
  p_owner_id uuid
)
RETURNS SETOF dna.dna_open_lab_finished_race_backfill_checkpoint
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped finished-race checkpoint read denied';
  END IF;
  RETURN QUERY
  SELECT stored.*
  FROM dna.dna_open_lab_finished_race_backfill_checkpoint stored
  WHERE stored.owner_id = p_owner_id;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_finished_race_window_receipt(
  p_owner_id uuid,
  p_window_key text
)
RETURNS SETOF dna.dna_open_lab_finished_race_window_receipt
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped finished-race receipt read denied';
  END IF;
  IF p_window_key !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'finished-race receipt key is invalid';
  END IF;
  RETURN QUERY
  SELECT receipt.*
  FROM dna.dna_open_lab_finished_race_window_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.window_key = p_window_key::character(64);
END
$function$;

REVOKE ALL ON TABLE
  dna.dna_open_lab_finished_race_backfill_checkpoint,
  dna.dna_open_lab_finished_race_window_receipt
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  dna.validate_dna_open_lab_finished_race_backfill_checkpoint(jsonb),
  dna.save_dna_open_lab_finished_race_backfill_checkpoint(uuid,bigint,jsonb,jsonb),
  dna.read_dna_open_lab_finished_race_backfill_checkpoint(uuid),
  dna.read_dna_open_lab_finished_race_window_receipt(uuid,text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.save_dna_open_lab_finished_race_backfill_checkpoint(uuid,bigint,jsonb,jsonb),
  dna.read_dna_open_lab_finished_race_backfill_checkpoint(uuid),
  dna.read_dna_open_lab_finished_race_window_receipt(uuid,text)
TO dna_app_runtime;

COMMIT;
