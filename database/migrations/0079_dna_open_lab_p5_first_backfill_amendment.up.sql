BEGIN;

ALTER TABLE dna.dna_open_lab_p5_first_backfill_run
  ADD COLUMN amendment_measurement_evidence_sha256 text NOT NULL DEFAULT
    'f0ca07ec08525f41a5fbf630cb5b33cef5910d37ed858046ff80bb826adffc9a',
  ADD COLUMN amendment_approval_ref_sha256 text NOT NULL DEFAULT
    '506e9e8333ff494bdd303c925dc8e6fdab98f27e336a8b2ccedb06bd01beb11f',
  ADD CONSTRAINT p5_backfill_amendment_measurement_sha_check CHECK (
    amendment_measurement_evidence_sha256 =
      'f0ca07ec08525f41a5fbf630cb5b33cef5910d37ed858046ff80bb826adffc9a'
  ),
  ADD CONSTRAINT p5_backfill_amendment_approval_sha_check CHECK (
    amendment_approval_ref_sha256 =
      '506e9e8333ff494bdd303c925dc8e6fdab98f27e336a8b2ccedb06bd01beb11f'
  );

DO $constraints$
DECLARE
  v_name text;
BEGIN
  SELECT constraint_row.conname INTO STRICT v_name
  FROM pg_catalog.pg_constraint constraint_row
  JOIN pg_catalog.pg_attribute attribute_row
    ON attribute_row.attrelid = constraint_row.conrelid
   AND attribute_row.attnum = ANY (constraint_row.conkey)
  WHERE constraint_row.conrelid =
      'dna.dna_open_lab_p5_first_backfill_run'::regclass
    AND constraint_row.contype = 'c'
    AND cardinality(constraint_row.conkey) = 1
    AND attribute_row.attname = 'next_request_ordinal';
  EXECUTE format(
    'ALTER TABLE dna.dna_open_lab_p5_first_backfill_run DROP CONSTRAINT %I',
    v_name
  );

  SELECT constraint_row.conname INTO STRICT v_name
  FROM pg_catalog.pg_constraint constraint_row
  JOIN pg_catalog.pg_attribute attribute_row
    ON attribute_row.attrelid = constraint_row.conrelid
   AND attribute_row.attnum = ANY (constraint_row.conkey)
  WHERE constraint_row.conrelid =
      'dna.dna_open_lab_p5_first_backfill_run'::regclass
    AND constraint_row.contype = 'c'
    AND cardinality(constraint_row.conkey) = 1
    AND attribute_row.attname = 'logical_request_count';
  EXECUTE format(
    'ALTER TABLE dna.dna_open_lab_p5_first_backfill_run DROP CONSTRAINT %I',
    v_name
  );

  SELECT constraint_row.conname INTO STRICT v_name
  FROM pg_catalog.pg_constraint constraint_row
  JOIN pg_catalog.pg_attribute attribute_row
    ON attribute_row.attrelid = constraint_row.conrelid
   AND attribute_row.attnum = ANY (constraint_row.conkey)
  WHERE constraint_row.conrelid =
      'dna.dna_open_lab_p5_first_backfill_run'::regclass
    AND constraint_row.contype = 'c'
    AND cardinality(constraint_row.conkey) = 1
    AND attribute_row.attname = 'retained_r2_bytes';
  EXECUTE format(
    'ALTER TABLE dna.dna_open_lab_p5_first_backfill_run DROP CONSTRAINT %I',
    v_name
  );

  SELECT constraint_row.conname INTO STRICT v_name
  FROM pg_catalog.pg_constraint constraint_row
  JOIN pg_catalog.pg_attribute attribute_row
    ON attribute_row.attrelid = constraint_row.conrelid
   AND attribute_row.attnum = ANY (constraint_row.conkey)
  WHERE constraint_row.conrelid =
      'dna.dna_open_lab_p5_first_backfill_request_receipt'::regclass
    AND constraint_row.contype = 'c'
    AND cardinality(constraint_row.conkey) = 1
    AND attribute_row.attname = 'request_ordinal';
  EXECUTE format(
    'ALTER TABLE dna.dna_open_lab_p5_first_backfill_request_receipt DROP CONSTRAINT %I',
    v_name
  );
END
$constraints$;

ALTER TABLE dna.dna_open_lab_p5_first_backfill_run
  ADD CONSTRAINT p5_backfill_run_next_ordinal_amended_check CHECK (
    next_request_ordinal BETWEEN 1 AND 17457
  ),
  ADD CONSTRAINT p5_backfill_run_request_count_amended_check CHECK (
    logical_request_count BETWEEN 0 AND 17456
  ),
  ADD CONSTRAINT p5_backfill_run_retained_bytes_amended_check CHECK (
    retained_r2_bytes BETWEEN 0 AND 1151165717
  );

ALTER TABLE dna.dna_open_lab_p5_first_backfill_request_receipt
  ADD CONSTRAINT p5_backfill_receipt_ordinal_amended_check CHECK (
    request_ordinal BETWEEN 1 AND 17456
  );

CREATE FUNCTION dna.initialize_dna_open_lab_p5_first_backfill_run(
  p_owner_id uuid,
  p_measurement_evidence_sha256 text,
  p_approval_ref_sha256 text,
  p_authority_cutoff_at timestamptz,
  p_amendment_approval_ref_sha256 text
)
RETURNS TABLE (
  revision bigint,
  status text,
  next_request_ordinal integer,
  logical_request_count integer,
  retained_r2_bytes bigint,
  omitted_identity_observation_count integer,
  completion_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_measurement_sha constant text :=
    '250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4';
  v_amendment_measurement_sha constant text :=
    'f0ca07ec08525f41a5fbf630cb5b33cef5910d37ed858046ff80bb826adffc9a';
  v_amendment_approval_sha constant text :=
    '506e9e8333ff494bdd303c925dc8e6fdab98f27e336a8b2ccedb06bd01beb11f';
  v_run dna.dna_open_lab_p5_first_backfill_run%ROWTYPE;
BEGIN
  IF p_amendment_approval_ref_sha256 IS NULL
     OR p_amendment_approval_ref_sha256 <> v_amendment_approval_sha THEN
    RAISE EXCEPTION 'P5 first-backfill amendment authority does not match';
  END IF;
  PERFORM * FROM dna.initialize_dna_open_lab_p5_first_backfill_run(
    p_owner_id, p_measurement_evidence_sha256, p_approval_ref_sha256,
    p_authority_cutoff_at
  );
  SELECT stored.* INTO STRICT v_run
  FROM dna.dna_open_lab_p5_first_backfill_run stored
  WHERE stored.owner_id = p_owner_id
    AND stored.measurement_evidence_sha256 = v_measurement_sha;
  IF v_run.amendment_measurement_evidence_sha256 <>
       v_amendment_measurement_sha
     OR v_run.amendment_approval_ref_sha256 <>
       v_amendment_approval_sha THEN
    RAISE EXCEPTION 'P5 first-backfill stored amendment authority drifted';
  END IF;
  RETURN QUERY SELECT v_run.revision, v_run.status,
    v_run.next_request_ordinal, v_run.logical_request_count,
    v_run.retained_r2_bytes, v_run.omitted_identity_observation_count,
    v_run.completion_sha256;
END
$function$;

CREATE FUNCTION dna.record_dna_open_lab_p5_first_backfill_amended_receipt(
  p_owner_id uuid,
  p_measurement_evidence_sha256 text,
  p_expected_revision bigint,
  p_request_ordinal integer,
  p_family text,
  p_observed_at timestamptz,
  p_content_sha256 text,
  p_byte_length integer,
  p_evidence_object_key text,
  p_omitted_identity_observation_count integer,
  p_quarantine_bound boolean
)
RETURNS TABLE (
  revision bigint,
  status text,
  next_request_ordinal integer,
  logical_request_count integer,
  retained_r2_bytes bigint,
  omitted_identity_observation_count integer,
  completion_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_measurement_sha constant text :=
    '250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4';
  v_amendment_measurement_sha constant text :=
    'f0ca07ec08525f41a5fbf630cb5b33cef5910d37ed858046ff80bb826adffc9a';
  v_amendment_approval_sha constant text :=
    '506e9e8333ff494bdd303c925dc8e6fdab98f27e336a8b2ccedb06bd01beb11f';
  v_run dna.dna_open_lab_p5_first_backfill_run%ROWTYPE;
  v_receipt dna.dna_open_lab_p5_first_backfill_request_receipt%ROWTYPE;
  v_expected_key_suffix text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped P5 first-backfill receipt denied';
  END IF;
  IF p_measurement_evidence_sha256 IS NULL
     OR p_request_ordinal IS NULL OR p_family IS NULL
     OR p_observed_at IS NULL OR p_content_sha256 IS NULL
     OR p_byte_length IS NULL OR p_evidence_object_key IS NULL
     OR p_omitted_identity_observation_count IS NULL
     OR p_quarantine_bound IS NULL
     OR p_measurement_evidence_sha256 <> v_measurement_sha
     OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_request_ordinal NOT BETWEEN 1 AND 17456
     OR p_family NOT IN (
       'finished_races', 'race_activity', 'token_prices', 'vault_identity',
       'core_current_state', 'splice_arena'
     )
     OR p_content_sha256 !~ '^[a-f0-9]{64}$'
     OR p_byte_length NOT BETWEEN 1 AND 8388608
     OR length(p_evidence_object_key) NOT BETWEEN 1 AND 4096
     OR p_evidence_object_key ~ '[[:cntrl:]]'
     OR p_omitted_identity_observation_count NOT BETWEEN 0 AND 1
     OR p_quarantine_bound IS DISTINCT FROM
        (p_omitted_identity_observation_count = 1)
     OR (p_omitted_identity_observation_count = 1
         AND p_family <> 'finished_races') THEN
    RAISE EXCEPTION 'P5 first-backfill receipt is invalid';
  END IF;
  v_expected_key_suffix := '/first-private-preview-backfill/'
    || v_measurement_sha || '/requests/'
    || lpad(p_request_ordinal::text, 6, '0') || '.json';
  IF p_evidence_object_key !~ '^dna-open-lab/v1/[a-f0-9]{64}/'
     OR right(p_evidence_object_key, length(v_expected_key_suffix)) <>
        v_expected_key_suffix THEN
    RAISE EXCEPTION 'P5 first-backfill receipt object identity is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':' || v_measurement_sha || ':p5-first-backfill', 0)
  );
  SELECT stored.* INTO STRICT v_run
  FROM dna.dna_open_lab_p5_first_backfill_run stored
  WHERE stored.owner_id = p_owner_id
    AND stored.measurement_evidence_sha256 = v_measurement_sha
  FOR UPDATE;
  IF v_run.amendment_measurement_evidence_sha256 <>
       v_amendment_measurement_sha
     OR v_run.amendment_approval_ref_sha256 <>
       v_amendment_approval_sha THEN
    RAISE EXCEPTION 'P5 first-backfill stored amendment authority drifted';
  END IF;

  SELECT stored.* INTO v_receipt
  FROM dna.dna_open_lab_p5_first_backfill_request_receipt stored
  WHERE stored.owner_id = p_owner_id
    AND stored.measurement_evidence_sha256 = v_measurement_sha
    AND stored.request_ordinal = p_request_ordinal;
  IF FOUND THEN
    IF v_receipt.family <> p_family
       OR v_receipt.observed_at <> p_observed_at
       OR v_receipt.content_sha256 <> p_content_sha256
       OR v_receipt.byte_length <> p_byte_length
       OR v_receipt.evidence_object_key <> p_evidence_object_key
       OR v_receipt.omitted_identity_observation_count <>
          p_omitted_identity_observation_count
       OR v_receipt.quarantine_bound <> p_quarantine_bound THEN
      RAISE EXCEPTION 'P5 first-backfill receipt conflicts with durable evidence';
    END IF;
    RETURN QUERY SELECT v_run.revision, v_run.status,
      v_run.next_request_ordinal, v_run.logical_request_count,
      v_run.retained_r2_bytes, v_run.omitted_identity_observation_count,
      v_run.completion_sha256;
    RETURN;
  END IF;

  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION 'P5 first-backfill completed run cannot advance';
  END IF;
  IF v_run.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'P5 first-backfill revision conflict';
  END IF;
  IF p_request_ordinal <> v_run.next_request_ordinal THEN
    RAISE EXCEPTION 'P5 first-backfill receipt is out of order';
  END IF;
  IF v_run.retained_r2_bytes + p_byte_length > 1151165717 THEN
    RAISE EXCEPTION 'P5 first-backfill retained-byte bound exceeded';
  END IF;
  IF v_run.omitted_identity_observation_count
       + p_omitted_identity_observation_count > 1 THEN
    RAISE EXCEPTION 'P5 first-backfill identity-omission authority exceeded';
  END IF;

  INSERT INTO dna.dna_open_lab_p5_first_backfill_request_receipt (
    owner_id, measurement_evidence_sha256, request_ordinal, family,
    observed_at, content_sha256, byte_length, evidence_object_key,
    omitted_identity_observation_count, quarantine_bound
  ) VALUES (
    p_owner_id, v_measurement_sha, p_request_ordinal, p_family,
    p_observed_at, p_content_sha256, p_byte_length, p_evidence_object_key,
    p_omitted_identity_observation_count, p_quarantine_bound
  );

  UPDATE dna.dna_open_lab_p5_first_backfill_run stored
  SET revision = stored.revision + 1,
      next_request_ordinal = stored.next_request_ordinal + 1,
      logical_request_count = stored.logical_request_count + 1,
      retained_r2_bytes = stored.retained_r2_bytes + p_byte_length,
      omitted_identity_observation_count =
        stored.omitted_identity_observation_count
        + p_omitted_identity_observation_count,
      updated_at = clock_timestamp()
  WHERE stored.owner_id = p_owner_id
    AND stored.measurement_evidence_sha256 = v_measurement_sha
  RETURNING stored.* INTO v_run;

  RETURN QUERY SELECT v_run.revision, v_run.status,
    v_run.next_request_ordinal, v_run.logical_request_count,
    v_run.retained_r2_bytes, v_run.omitted_identity_observation_count,
    v_run.completion_sha256;
END
$function$;

CREATE FUNCTION dna.complete_dna_open_lab_p5_first_backfill_amended_run(
  p_owner_id uuid,
  p_measurement_evidence_sha256 text,
  p_expected_revision bigint,
  p_completion_sha256 text
)
RETURNS TABLE (
  revision bigint,
  status text,
  next_request_ordinal integer,
  logical_request_count integer,
  retained_r2_bytes bigint,
  omitted_identity_observation_count integer,
  completion_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_measurement_sha constant text :=
    '250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4';
  v_amendment_measurement_sha constant text :=
    'f0ca07ec08525f41a5fbf630cb5b33cef5910d37ed858046ff80bb826adffc9a';
  v_amendment_approval_sha constant text :=
    '506e9e8333ff494bdd303c925dc8e6fdab98f27e336a8b2ccedb06bd01beb11f';
  v_run dna.dna_open_lab_p5_first_backfill_run%ROWTYPE;
  v_family_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped P5 first-backfill completion denied';
  END IF;
  IF p_measurement_evidence_sha256 IS NULL
     OR p_completion_sha256 IS NULL
     OR p_measurement_evidence_sha256 <> v_measurement_sha
     OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_completion_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'P5 first-backfill completion authority is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':' || v_measurement_sha || ':p5-first-backfill', 0)
  );
  SELECT stored.* INTO STRICT v_run
  FROM dna.dna_open_lab_p5_first_backfill_run stored
  WHERE stored.owner_id = p_owner_id
    AND stored.measurement_evidence_sha256 = v_measurement_sha
  FOR UPDATE;
  IF v_run.amendment_measurement_evidence_sha256 <>
       v_amendment_measurement_sha
     OR v_run.amendment_approval_ref_sha256 <>
       v_amendment_approval_sha THEN
    RAISE EXCEPTION 'P5 first-backfill stored amendment authority drifted';
  END IF;

  IF v_run.status = 'complete' THEN
    IF v_run.completion_sha256 <> p_completion_sha256 THEN
      RAISE EXCEPTION 'P5 first-backfill completion conflicts with durable authority';
    END IF;
    RETURN QUERY SELECT v_run.revision, v_run.status,
      v_run.next_request_ordinal, v_run.logical_request_count,
      v_run.retained_r2_bytes, v_run.omitted_identity_observation_count,
      v_run.completion_sha256;
    RETURN;
  END IF;
  IF v_run.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'P5 first-backfill completion revision conflict';
  END IF;
  SELECT count(DISTINCT receipt.family)::integer INTO v_family_count
  FROM dna.dna_open_lab_p5_first_backfill_request_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.measurement_evidence_sha256 = v_measurement_sha;
  IF v_run.logical_request_count <> 17456
     OR v_run.next_request_ordinal <> 17457
     OR v_run.omitted_identity_observation_count <> 1
     OR v_family_count <> 6 THEN
    RAISE EXCEPTION 'P5 first-backfill inventory is incomplete';
  END IF;

  UPDATE dna.dna_open_lab_p5_first_backfill_run stored
  SET revision = stored.revision + 1, status = 'complete',
      completion_sha256 = p_completion_sha256,
      updated_at = clock_timestamp()
  WHERE stored.owner_id = p_owner_id
    AND stored.measurement_evidence_sha256 = v_measurement_sha
  RETURNING stored.* INTO v_run;
  RETURN QUERY SELECT v_run.revision, v_run.status,
    v_run.next_request_ordinal, v_run.logical_request_count,
    v_run.retained_r2_bytes, v_run.omitted_identity_observation_count,
    v_run.completion_sha256;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_p5_first_backfill_amended_receipts(
  p_owner_id uuid,
  p_measurement_evidence_sha256 text,
  p_after_request_ordinal integer,
  p_limit integer
)
RETURNS TABLE (
  family text,
  request_ordinal integer,
  observed_at timestamptz,
  content_sha256 text,
  byte_length integer,
  evidence_object_key text,
  omitted_identity_observation_count integer,
  quarantine_bound boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped P5 first-backfill receipt read denied';
  END IF;
  IF p_after_request_ordinal IS NULL OR p_limit IS NULL
     OR p_after_request_ordinal NOT BETWEEN 0 AND 17456
     OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'P5 first-backfill receipt page is invalid';
  END IF;
  RETURN QUERY
  SELECT receipt.family, receipt.request_ordinal, receipt.observed_at,
    receipt.content_sha256, receipt.byte_length, receipt.evidence_object_key,
    receipt.omitted_identity_observation_count, receipt.quarantine_bound
  FROM dna.dna_open_lab_p5_first_backfill_request_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.measurement_evidence_sha256 = p_measurement_evidence_sha256
    AND receipt.request_ordinal > p_after_request_ordinal
  ORDER BY receipt.request_ordinal
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON FUNCTION dna.initialize_dna_open_lab_p5_first_backfill_run(
  uuid, text, text, timestamptz, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_dna_open_lab_p5_first_backfill_amended_receipt(
  uuid, text, bigint, integer, text, timestamptz, text, integer, text,
  integer, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.complete_dna_open_lab_p5_first_backfill_amended_run(
  uuid, text, bigint, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_p5_first_backfill_amended_receipts(
  uuid, text, integer, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.initialize_dna_open_lab_p5_first_backfill_run(
  uuid, text, text, timestamptz, text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_dna_open_lab_p5_first_backfill_amended_receipt(
  uuid, text, bigint, integer, text, timestamptz, text, integer, text,
  integer, boolean
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.complete_dna_open_lab_p5_first_backfill_amended_run(
  uuid, text, bigint, text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_p5_first_backfill_amended_receipts(
  uuid, text, integer, integer
) TO dna_app_runtime;

COMMIT;
