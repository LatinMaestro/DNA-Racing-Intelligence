BEGIN;

ALTER TABLE dna.dna_open_lab_p5_first_backfill_run
  ADD COLUMN terminal_checkpoint_measurement_evidence_sha256 text NOT NULL DEFAULT
    '6b37abfef198cf8bb4dca395b238bf07b0f0961da5b3e2a1f1215a66ff431e9b',
  ADD COLUMN terminal_residual_measurement_evidence_sha256 text NOT NULL DEFAULT
    '95485e7720f1dc04f8fdbf10f1e11c85a1999d448dc61c802896435dcfd2a173',
  ADD COLUMN terminal_residual_approval_ref_sha256 text NOT NULL DEFAULT
    'ef878c23bac0b2a46aa326eda97b6f1933eb49e218b3f0928dab4205b91b09bd',
  ADD COLUMN maximum_authorized_micro_usd integer NOT NULL DEFAULT 2000000,
  ADD CONSTRAINT p5_backfill_terminal_checkpoint_measurement_sha_check CHECK (
    terminal_checkpoint_measurement_evidence_sha256 =
      '6b37abfef198cf8bb4dca395b238bf07b0f0961da5b3e2a1f1215a66ff431e9b'
  ),
  ADD CONSTRAINT p5_backfill_terminal_residual_measurement_sha_check CHECK (
    terminal_residual_measurement_evidence_sha256 =
      '95485e7720f1dc04f8fdbf10f1e11c85a1999d448dc61c802896435dcfd2a173'
  ),
  ADD CONSTRAINT p5_backfill_terminal_approval_sha_check CHECK (
    terminal_residual_approval_ref_sha256 =
      'ef878c23bac0b2a46aa326eda97b6f1933eb49e218b3f0928dab4205b91b09bd'
  ),
  ADD CONSTRAINT p5_backfill_terminal_cost_ceiling_check CHECK (
    maximum_authorized_micro_usd = 2000000
  );

ALTER TABLE dna.dna_open_lab_p5_first_backfill_request_receipt
  DROP CONSTRAINT p5_backfill_receipt_ordinal_amended_check,
  ADD CONSTRAINT p5_backfill_receipt_ordinal_terminal_check CHECK (
    request_ordinal BETWEEN 1 AND 17464
  );

ALTER TABLE dna.dna_open_lab_p5_first_backfill_run
  DROP CONSTRAINT p5_backfill_run_next_ordinal_amended_check,
  DROP CONSTRAINT p5_backfill_run_request_count_amended_check,
  DROP CONSTRAINT p5_backfill_run_retained_bytes_amended_check,
  ADD CONSTRAINT p5_backfill_run_next_ordinal_terminal_check CHECK (
    next_request_ordinal BETWEEN 1 AND 17465
  ),
  ADD CONSTRAINT p5_backfill_run_request_count_terminal_check CHECK (
    logical_request_count BETWEEN 0 AND 17464
  ),
  ADD CONSTRAINT p5_backfill_run_retained_bytes_terminal_check CHECK (
    retained_r2_bytes BETWEEN 0 AND 1151353687
  );

CREATE FUNCTION dna.initialize_dna_open_lab_p5_first_backfill_terminal_run(
  p_owner_id uuid,
  p_measurement_evidence_sha256 text,
  p_approval_ref_sha256 text,
  p_authority_cutoff_at timestamptz,
  p_amendment_approval_ref_sha256 text,
  p_terminal_residual_approval_ref_sha256 text
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
  v_terminal_checkpoint_sha constant text :=
    '6b37abfef198cf8bb4dca395b238bf07b0f0961da5b3e2a1f1215a66ff431e9b';
  v_terminal_residual_sha constant text :=
    '95485e7720f1dc04f8fdbf10f1e11c85a1999d448dc61c802896435dcfd2a173';
  v_terminal_approval_sha constant text :=
    'ef878c23bac0b2a46aa326eda97b6f1933eb49e218b3f0928dab4205b91b09bd';
  v_run dna.dna_open_lab_p5_first_backfill_run%ROWTYPE;
BEGIN
  IF p_terminal_residual_approval_ref_sha256 IS NULL
     OR p_terminal_residual_approval_ref_sha256 <> v_terminal_approval_sha THEN
    RAISE EXCEPTION 'P5 first-backfill terminal residual authority does not match';
  END IF;
  PERFORM * FROM dna.initialize_dna_open_lab_p5_first_backfill_run(
    p_owner_id, p_measurement_evidence_sha256, p_approval_ref_sha256,
    p_authority_cutoff_at, p_amendment_approval_ref_sha256
  );
  SELECT stored.* INTO STRICT v_run
  FROM dna.dna_open_lab_p5_first_backfill_run stored
  WHERE stored.owner_id = p_owner_id
    AND stored.measurement_evidence_sha256 = v_measurement_sha;
  IF v_run.terminal_checkpoint_measurement_evidence_sha256 <>
       v_terminal_checkpoint_sha
     OR v_run.terminal_residual_measurement_evidence_sha256 <>
       v_terminal_residual_sha
     OR v_run.terminal_residual_approval_ref_sha256 <>
       v_terminal_approval_sha
     OR v_run.maximum_authorized_micro_usd <> 2000000 THEN
    RAISE EXCEPTION 'P5 first-backfill stored terminal authority drifted';
  END IF;
  RETURN QUERY SELECT v_run.revision, v_run.status,
    v_run.next_request_ordinal, v_run.logical_request_count,
    v_run.retained_r2_bytes, v_run.omitted_identity_observation_count,
    v_run.completion_sha256;
END
$function$;

CREATE FUNCTION dna.record_dna_open_lab_p5_first_backfill_terminal_receipt(
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
  v_terminal_checkpoint_sha constant text :=
    '6b37abfef198cf8bb4dca395b238bf07b0f0961da5b3e2a1f1215a66ff431e9b';
  v_terminal_residual_sha constant text :=
    '95485e7720f1dc04f8fdbf10f1e11c85a1999d448dc61c802896435dcfd2a173';
  v_terminal_approval_sha constant text :=
    'ef878c23bac0b2a46aa326eda97b6f1933eb49e218b3f0928dab4205b91b09bd';
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
     OR p_request_ordinal NOT BETWEEN 17457 AND 17464
     OR (p_request_ordinal BETWEEN 17457 AND 17461
         AND p_family <> 'core_current_state')
     OR (p_request_ordinal BETWEEN 17462 AND 17464
         AND p_family <> 'splice_arena')
     OR p_content_sha256 !~ '^[a-f0-9]{64}$'
     OR p_byte_length NOT BETWEEN 1 AND 8388608
     OR length(p_evidence_object_key) NOT BETWEEN 1 AND 4096
     OR p_evidence_object_key ~ '[[:cntrl:]]'
     OR p_omitted_identity_observation_count <> 0
     OR p_quarantine_bound THEN
    RAISE EXCEPTION 'P5 first-backfill terminal receipt is invalid';
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
  IF v_run.terminal_checkpoint_measurement_evidence_sha256 <>
       v_terminal_checkpoint_sha
     OR v_run.terminal_residual_measurement_evidence_sha256 <>
       v_terminal_residual_sha
     OR v_run.terminal_residual_approval_ref_sha256 <>
       v_terminal_approval_sha
     OR v_run.maximum_authorized_micro_usd <> 2000000 THEN
    RAISE EXCEPTION 'P5 first-backfill stored terminal authority drifted';
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
       OR v_receipt.omitted_identity_observation_count <> 0
       OR v_receipt.quarantine_bound THEN
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
  IF v_run.retained_r2_bytes + p_byte_length > 1151353687 THEN
    RAISE EXCEPTION 'P5 first-backfill retained-byte bound exceeded';
  END IF;
  IF v_run.omitted_identity_observation_count <> 1 THEN
    RAISE EXCEPTION 'P5 first-backfill identity-omission authority drifted';
  END IF;

  INSERT INTO dna.dna_open_lab_p5_first_backfill_request_receipt (
    owner_id, measurement_evidence_sha256, request_ordinal, family,
    observed_at, content_sha256, byte_length, evidence_object_key,
    omitted_identity_observation_count, quarantine_bound
  ) VALUES (
    p_owner_id, v_measurement_sha, p_request_ordinal, p_family,
    p_observed_at, p_content_sha256, p_byte_length, p_evidence_object_key,
    0, false
  );

  UPDATE dna.dna_open_lab_p5_first_backfill_run stored
  SET revision = stored.revision + 1,
      next_request_ordinal = stored.next_request_ordinal + 1,
      logical_request_count = stored.logical_request_count + 1,
      retained_r2_bytes = stored.retained_r2_bytes + p_byte_length,
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

CREATE FUNCTION dna.complete_dna_open_lab_p5_first_backfill_terminal_run(
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
  v_terminal_checkpoint_sha constant text :=
    '6b37abfef198cf8bb4dca395b238bf07b0f0961da5b3e2a1f1215a66ff431e9b';
  v_terminal_residual_sha constant text :=
    '95485e7720f1dc04f8fdbf10f1e11c85a1999d448dc61c802896435dcfd2a173';
  v_terminal_approval_sha constant text :=
    'ef878c23bac0b2a46aa326eda97b6f1933eb49e218b3f0928dab4205b91b09bd';
  v_run dna.dna_open_lab_p5_first_backfill_run%ROWTYPE;
  v_finished integer;
  v_activity integer;
  v_token integer;
  v_vault integer;
  v_core integer;
  v_splice integer;
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
  IF v_run.terminal_checkpoint_measurement_evidence_sha256 <>
       v_terminal_checkpoint_sha
     OR v_run.terminal_residual_measurement_evidence_sha256 <>
       v_terminal_residual_sha
     OR v_run.terminal_residual_approval_ref_sha256 <>
       v_terminal_approval_sha
     OR v_run.maximum_authorized_micro_usd <> 2000000 THEN
    RAISE EXCEPTION 'P5 first-backfill stored terminal authority drifted';
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
  SELECT
    count(*) FILTER (WHERE receipt.family = 'finished_races')::integer,
    count(*) FILTER (WHERE receipt.family = 'race_activity')::integer,
    count(*) FILTER (WHERE receipt.family = 'token_prices')::integer,
    count(*) FILTER (WHERE receipt.family = 'vault_identity')::integer,
    count(*) FILTER (WHERE receipt.family = 'core_current_state')::integer,
    count(*) FILTER (WHERE receipt.family = 'splice_arena')::integer
  INTO v_finished, v_activity, v_token, v_vault, v_core, v_splice
  FROM dna.dna_open_lab_p5_first_backfill_request_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.measurement_evidence_sha256 = v_measurement_sha;
  IF v_run.logical_request_count <> 17464
     OR v_run.next_request_ordinal <> 17465
     OR v_run.omitted_identity_observation_count <> 1
     OR (v_finished, v_activity, v_token, v_vault, v_core, v_splice) <>
        (17369, 7, 1, 4, 80, 3) THEN
    RAISE EXCEPTION 'P5 first-backfill terminal inventory is incomplete';
  END IF;

  UPDATE dna.dna_open_lab_p5_first_backfill_run stored
  SET revision = stored.revision + 1,
      status = 'complete',
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

CREATE FUNCTION dna.read_dna_open_lab_p5_first_backfill_terminal_receipts(
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
  IF p_measurement_evidence_sha256 IS NULL
     OR p_measurement_evidence_sha256 <>
       '250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4'
     OR p_after_request_ordinal IS NULL OR p_limit IS NULL
     OR p_after_request_ordinal NOT BETWEEN 0 AND 17464
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

REVOKE ALL ON FUNCTION dna.initialize_dna_open_lab_p5_first_backfill_terminal_run(
  uuid, text, text, timestamptz, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_dna_open_lab_p5_first_backfill_terminal_receipt(
  uuid, text, bigint, integer, text, timestamptz, text, integer, text,
  integer, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.complete_dna_open_lab_p5_first_backfill_terminal_run(
  uuid, text, bigint, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_p5_first_backfill_terminal_receipts(
  uuid, text, integer, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.initialize_dna_open_lab_p5_first_backfill_terminal_run(
  uuid, text, text, timestamptz, text, text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_dna_open_lab_p5_first_backfill_terminal_receipt(
  uuid, text, bigint, integer, text, timestamptz, text, integer, text,
  integer, boolean
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.complete_dna_open_lab_p5_first_backfill_terminal_run(
  uuid, text, bigint, text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_p5_first_backfill_terminal_receipts(
  uuid, text, integer, integer
) TO dna_app_runtime;

COMMIT;
