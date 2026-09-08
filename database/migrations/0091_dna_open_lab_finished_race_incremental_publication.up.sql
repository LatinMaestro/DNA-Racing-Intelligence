BEGIN;

CREATE TABLE dna.dna_open_lab_finished_race_incremental_publication (
  owner_id uuid NOT NULL,
  cycle_id character(64) NOT NULL,
  previous_published_cycle_id character(64),
  attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 32),
  lower_bound_at timestamptz NOT NULL,
  upper_bound_at timestamptz NOT NULL,
  receipt_count integer NOT NULL CHECK (receipt_count > 0),
  document_count bigint NOT NULL CHECK (document_count >= 0),
  manifest_byte_length bigint NOT NULL CHECK (manifest_byte_length > 0),
  receipt_set_sha256 character(64) NOT NULL CHECK (
    receipt_set_sha256 ~ '^[a-f0-9]{64}$'
  ),
  validated_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, cycle_id),
  FOREIGN KEY (owner_id, cycle_id)
    REFERENCES dna.dna_open_lab_finished_race_incremental_cycle(owner_id, cycle_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, previous_published_cycle_id)
    REFERENCES dna.dna_open_lab_finished_race_incremental_publication(owner_id, cycle_id)
    ON DELETE RESTRICT,
  CHECK (
    previous_published_cycle_id IS NULL
    OR previous_published_cycle_id ~ '^[a-f0-9]{64}$'
  ),
  CHECK (lower_bound_at < upper_bound_at),
  CHECK (validated_at >= upper_bound_at),
  CHECK (published_at >= validated_at)
);

CREATE UNIQUE INDEX dna_open_lab_finished_race_incremental_publication_successor_uq
  ON dna.dna_open_lab_finished_race_incremental_publication (
    owner_id, previous_published_cycle_id
  )
  WHERE previous_published_cycle_id IS NOT NULL;

CREATE TABLE dna.dna_open_lab_finished_race_incremental_active (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  cycle_id character(64) NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, cycle_id)
    REFERENCES dna.dna_open_lab_finished_race_incremental_publication(owner_id, cycle_id)
    ON DELETE RESTRICT
);

ALTER TABLE dna.dna_open_lab_finished_race_incremental_publication
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_finished_race_incremental_publication
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_finished_race_incremental_publication
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_finished_race_incremental_active
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_finished_race_incremental_active
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_finished_race_incremental_active
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.read_dna_open_lab_finished_race_incremental_receipts(
  p_owner_id uuid,
  p_cycle_id text,
  p_attempt_number integer
)
RETURNS TABLE (
  cycle_id text,
  first_attempt_number integer,
  window_start_at timestamptz,
  window_end_at timestamptz,
  window_key text,
  content_sha256 text,
  document_count integer,
  manifest_object_key text,
  manifest_body_sha256 text,
  manifest_byte_length bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped finished-race receipt-set read denied';
  END IF;
  IF p_cycle_id !~ '^[a-f0-9]{64}$' OR p_attempt_number NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'finished-race receipt-set read key is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.dna_open_lab_finished_race_incremental_attempt attempt
    WHERE attempt.owner_id = p_owner_id
      AND attempt.cycle_id = p_cycle_id::character(64)
      AND attempt.attempt_number = p_attempt_number
      AND attempt.status = 'complete'
  ) THEN
    RAISE EXCEPTION 'finished-race receipt-set cycle is not complete';
  END IF;
  RETURN QUERY
  SELECT receipt.cycle_id::text, receipt.first_attempt_number::integer,
    receipt.window_start_at, receipt.window_end_at, receipt.window_key::text,
    receipt.content_sha256::text, receipt.document_count,
    receipt.manifest_object_key, receipt.manifest_body_sha256::text,
    receipt.manifest_byte_length
  FROM dna.dna_open_lab_finished_race_incremental_window_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.cycle_id = p_cycle_id::character(64)
    AND receipt.first_attempt_number <= p_attempt_number
  ORDER BY receipt.window_start_at, receipt.window_end_at, receipt.window_key;
END
$function$;

CREATE FUNCTION dna.publish_dna_open_lab_finished_race_incremental_cycle(
  p_owner_id uuid,
  p_cycle_id text,
  p_attempt_number integer,
  p_expected_receipt_count integer,
  p_expected_document_count bigint,
  p_expected_manifest_byte_length bigint,
  p_expected_receipt_set_sha256 character(64),
  p_validated_at timestamptz,
  p_published_at timestamptz
)
RETURNS TABLE (
  version integer,
  cycle_id text,
  previous_published_cycle_id text,
  attempt_number integer,
  lower_bound_at timestamptz,
  upper_bound_at timestamptz,
  receipt_count integer,
  document_count bigint,
  manifest_byte_length bigint,
  receipt_set_sha256 text,
  validated_at timestamptz,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_authority dna.dna_open_lab_finished_race_incremental_cycle%ROWTYPE;
  v_attempt dna.dna_open_lab_finished_race_incremental_attempt%ROWTYPE;
  v_existing dna.dna_open_lab_finished_race_incremental_publication%ROWTYPE;
  v_active dna.dna_open_lab_finished_race_incremental_active%ROWTYPE;
  v_previous character(64);
  v_receipt_count integer;
  v_document_count bigint;
  v_manifest_byte_length bigint;
  v_receipt_set_sha256 text;
  v_min_start timestamptz;
  v_max_end timestamptz;
  v_contiguous boolean;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped finished-race publication denied';
  END IF;
  IF p_cycle_id IS NULL OR p_cycle_id !~ '^[a-f0-9]{64}$'
     OR p_attempt_number IS NULL OR p_attempt_number NOT BETWEEN 1 AND 32
     OR p_expected_receipt_count IS NULL OR p_expected_receipt_count < 1
     OR p_expected_document_count IS NULL OR p_expected_document_count < 0
     OR p_expected_manifest_byte_length IS NULL OR p_expected_manifest_byte_length < 1
     OR p_expected_receipt_set_sha256 IS NULL
     OR p_expected_receipt_set_sha256 !~ '^[a-f0-9]{64}$'
     OR p_validated_at IS NULL OR p_published_at IS NULL
     OR p_published_at < p_validated_at THEN
    RAISE EXCEPTION 'finished-race publication request is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':finished-race-incremental-publication', 0
  ));
  SELECT authority.* INTO v_authority
  FROM dna.dna_open_lab_finished_race_incremental_cycle authority
  WHERE authority.owner_id = p_owner_id
    AND authority.cycle_id = p_cycle_id::character(64)
  FOR UPDATE;
  SELECT attempt.* INTO v_attempt
  FROM dna.dna_open_lab_finished_race_incremental_attempt attempt
  WHERE attempt.owner_id = p_owner_id
    AND attempt.cycle_id = p_cycle_id::character(64)
    AND attempt.attempt_number = p_attempt_number
  FOR UPDATE;
  IF v_authority.cycle_id IS NULL OR v_attempt.cycle_id IS NULL
     OR v_attempt.status <> 'complete'
     OR v_attempt.cycle ->> 'status' <> 'complete'
     OR jsonb_array_length(v_attempt.cycle -> 'checkpoint' -> 'pendingWindows') <> 0
     OR p_validated_at < (v_attempt.cycle -> 'completion' ->> 'completedAt')::timestamptz
     OR p_validated_at < v_authority.upper_bound_at THEN
    RAISE EXCEPTION 'finished-race publication cycle is not complete';
  END IF;
  v_previous := v_authority.previous_completed_cycle_id;

  SELECT publication.* INTO v_existing
  FROM dna.dna_open_lab_finished_race_incremental_publication publication
  WHERE publication.owner_id = p_owner_id
    AND publication.cycle_id = p_cycle_id::character(64)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.previous_published_cycle_id IS DISTINCT FROM v_previous
       OR v_existing.attempt_number <> p_attempt_number
       OR v_existing.receipt_count <> p_expected_receipt_count
       OR v_existing.document_count <> p_expected_document_count
       OR v_existing.manifest_byte_length <> p_expected_manifest_byte_length
       OR v_existing.receipt_set_sha256 <> p_expected_receipt_set_sha256
       OR v_existing.validated_at <> p_validated_at
       OR v_existing.published_at <> p_published_at THEN
      RAISE EXCEPTION 'finished-race publication replay conflicts';
    END IF;
    RETURN QUERY SELECT 1, v_existing.cycle_id::text,
      v_existing.previous_published_cycle_id::text,
      v_existing.attempt_number::integer, v_existing.lower_bound_at,
      v_existing.upper_bound_at, v_existing.receipt_count,
      v_existing.document_count, v_existing.manifest_byte_length,
      v_existing.receipt_set_sha256::text, v_existing.validated_at,
      v_existing.published_at;
    RETURN;
  END IF;

  SELECT active.* INTO v_active
  FROM dna.dna_open_lab_finished_race_incremental_active active
  WHERE active.owner_id = p_owner_id
  FOR UPDATE;
  IF (v_previous IS NULL AND v_active.cycle_id IS NOT NULL)
     OR (v_previous IS NOT NULL AND (
       v_active.cycle_id IS NULL OR v_active.cycle_id <> v_previous
       OR NOT EXISTS (
         SELECT 1
         FROM dna.dna_open_lab_finished_race_incremental_publication prior
         WHERE prior.owner_id = p_owner_id AND prior.cycle_id = v_previous
           AND prior.upper_bound_at = v_authority.lower_bound_at
       )
     )) THEN
    RAISE EXCEPTION 'finished-race publication predecessor is not last-good';
  END IF;

  WITH ordered AS (
    SELECT receipt.*,
      lag(receipt.window_end_at) OVER (
        ORDER BY receipt.window_start_at, receipt.window_end_at, receipt.window_key
      ) AS previous_end,
      concat_ws('|',
        ((extract(epoch FROM receipt.window_start_at) * 1000)::bigint)::text,
        ((extract(epoch FROM receipt.window_end_at) * 1000)::bigint)::text,
        receipt.window_key::text,
        receipt.content_sha256::text,
        receipt.document_count::text,
        octet_length(receipt.manifest_object_key)::text || ':' || receipt.manifest_object_key,
        receipt.manifest_body_sha256::text,
        receipt.manifest_byte_length::text
      ) AS hash_line
    FROM dna.dna_open_lab_finished_race_incremental_window_receipt receipt
    WHERE receipt.owner_id = p_owner_id
      AND receipt.cycle_id = p_cycle_id::character(64)
      AND receipt.first_attempt_number <= p_attempt_number
  )
  SELECT count(*)::integer, COALESCE(sum(ordered.document_count), 0)::bigint,
    COALESCE(sum(ordered.manifest_byte_length), 0)::bigint,
    encode(sha256(convert_to(COALESCE(string_agg(
      ordered.hash_line, E'\n' ORDER BY ordered.window_start_at,
      ordered.window_end_at, ordered.window_key
    ), ''), 'UTF8')), 'hex'),
    min(ordered.window_start_at), max(ordered.window_end_at),
    COALESCE(bool_and(
      ordered.previous_end IS NULL OR ordered.window_start_at = ordered.previous_end
    ), false)
  INTO v_receipt_count, v_document_count, v_manifest_byte_length,
    v_receipt_set_sha256, v_min_start, v_max_end, v_contiguous
  FROM ordered;

  IF v_receipt_count <> p_expected_receipt_count
     OR v_document_count <> p_expected_document_count
     OR v_manifest_byte_length <> p_expected_manifest_byte_length
     OR v_receipt_set_sha256 <> p_expected_receipt_set_sha256::text
     OR v_receipt_count <> (v_attempt.cycle -> 'checkpoint' ->> 'completedWindowCount')::integer
     OR v_document_count <> (v_attempt.cycle -> 'checkpoint' ->> 'publishedWindowDocumentCount')::bigint
     OR v_min_start <> v_authority.lower_bound_at
     OR v_max_end <> v_authority.upper_bound_at
     OR NOT v_contiguous THEN
    RAISE EXCEPTION 'finished-race publication receipt set is incomplete or drifted';
  END IF;

  INSERT INTO dna.dna_open_lab_finished_race_incremental_publication (
    owner_id, cycle_id, previous_published_cycle_id, attempt_number,
    lower_bound_at, upper_bound_at, receipt_count, document_count,
    manifest_byte_length, receipt_set_sha256, validated_at, published_at
  ) VALUES (
    p_owner_id, p_cycle_id::character(64), v_previous, p_attempt_number,
    v_authority.lower_bound_at, v_authority.upper_bound_at, v_receipt_count,
    v_document_count, v_manifest_byte_length,
    v_receipt_set_sha256::character(64), p_validated_at, p_published_at
  );
  INSERT INTO dna.dna_open_lab_finished_race_incremental_active (
    owner_id, cycle_id, activated_at
  ) VALUES (p_owner_id, p_cycle_id::character(64), p_published_at)
  ON CONFLICT (owner_id) DO UPDATE SET
    cycle_id = EXCLUDED.cycle_id, activated_at = EXCLUDED.activated_at;

  RETURN QUERY SELECT 1, p_cycle_id, v_previous::text, p_attempt_number,
    v_authority.lower_bound_at, v_authority.upper_bound_at, v_receipt_count,
    v_document_count, v_manifest_byte_length, v_receipt_set_sha256,
    p_validated_at, p_published_at;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_finished_race_incremental_last_good(
  p_owner_id uuid
)
RETURNS SETOF dna.dna_open_lab_finished_race_incremental_publication
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped finished-race last-good read denied';
  END IF;
  RETURN QUERY
  SELECT publication.*
  FROM dna.dna_open_lab_finished_race_incremental_active active
  JOIN dna.dna_open_lab_finished_race_incremental_publication publication
    ON publication.owner_id = active.owner_id
   AND publication.cycle_id = active.cycle_id
  WHERE active.owner_id = p_owner_id;
END
$function$;

REVOKE ALL ON TABLE
  dna.dna_open_lab_finished_race_incremental_publication,
  dna.dna_open_lab_finished_race_incremental_active
FROM PUBLIC;
REVOKE ALL ON TABLE
  dna.dna_open_lab_finished_race_incremental_publication,
  dna.dna_open_lab_finished_race_incremental_active
FROM dna_app_runtime;
REVOKE ALL ON FUNCTION
  dna.read_dna_open_lab_finished_race_incremental_receipts(uuid,text,integer),
  dna.publish_dna_open_lab_finished_race_incremental_cycle(
    uuid,text,integer,integer,bigint,bigint,character,timestamptz,timestamptz
  ),
  dna.read_dna_open_lab_finished_race_incremental_last_good(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  dna.read_dna_open_lab_finished_race_incremental_receipts(uuid,text,integer),
  dna.publish_dna_open_lab_finished_race_incremental_cycle(
    uuid,text,integer,integer,bigint,bigint,character,timestamptz,timestamptz
  ),
  dna.read_dna_open_lab_finished_race_incremental_last_good(uuid)
TO dna_app_runtime;

COMMIT;
