BEGIN;

CREATE TABLE dna.dna_open_lab_p5_first_backfill_run (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  measurement_evidence_sha256 text NOT NULL,
  approval_ref_sha256 text NOT NULL,
  authority_cutoff_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('running', 'complete')),
  next_request_ordinal integer NOT NULL CHECK (
    next_request_ordinal BETWEEN 1 AND 17454
  ),
  logical_request_count integer NOT NULL CHECK (
    logical_request_count BETWEEN 0 AND 17453
  ),
  retained_r2_bytes bigint NOT NULL CHECK (
    retained_r2_bytes BETWEEN 0 AND 1151071826
  ),
  omitted_identity_observation_count integer NOT NULL CHECK (
    omitted_identity_observation_count BETWEEN 0 AND 1
  ),
  completion_sha256 text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, measurement_evidence_sha256),
  CHECK (measurement_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (approval_ref_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (next_request_ordinal = logical_request_count + 1),
  CHECK (
    (status = 'running' AND completion_sha256 IS NULL)
    OR (status = 'complete' AND completion_sha256 ~ '^[a-f0-9]{64}$')
  )
);

CREATE TABLE dna.dna_open_lab_p5_first_backfill_request_receipt (
  owner_id uuid NOT NULL,
  measurement_evidence_sha256 text NOT NULL,
  request_ordinal integer NOT NULL CHECK (
    request_ordinal BETWEEN 1 AND 17453
  ),
  family text NOT NULL CHECK (family IN (
    'finished_races', 'race_activity', 'token_prices', 'vault_identity',
    'core_current_state', 'splice_arena'
  )),
  observed_at timestamptz NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  evidence_object_key text NOT NULL CHECK (
    length(evidence_object_key) BETWEEN 1 AND 4096
    AND evidence_object_key !~ '[[:cntrl:]]'
  ),
  omitted_identity_observation_count integer NOT NULL CHECK (
    omitted_identity_observation_count BETWEEN 0 AND 1
  ),
  quarantine_bound boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, measurement_evidence_sha256, request_ordinal),
  FOREIGN KEY (owner_id, measurement_evidence_sha256)
    REFERENCES dna.dna_open_lab_p5_first_backfill_run(
      owner_id, measurement_evidence_sha256
    ) ON DELETE CASCADE,
  CHECK (
    quarantine_bound = (omitted_identity_observation_count = 1)
  ),
  CHECK (
    omitted_identity_observation_count = 0 OR family = 'finished_races'
  )
);

ALTER TABLE dna.dna_open_lab_p5_first_backfill_run
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_p5_first_backfill_run
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_p5_first_backfill_run
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_p5_first_backfill_request_receipt
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_p5_first_backfill_request_receipt
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation
  ON dna.dna_open_lab_p5_first_backfill_request_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.initialize_dna_open_lab_p5_first_backfill_run(
  p_owner_id uuid,
  p_measurement_evidence_sha256 text,
  p_approval_ref_sha256 text,
  p_authority_cutoff_at timestamptz
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
  v_approval_sha constant text :=
    'ea4f931d740ee2085cec4300924a6acf663a6484fc18cda32258034807984a40';
  v_cutoff constant timestamptz := '2026-09-02T00:11:55.961Z';
  v_run dna.dna_open_lab_p5_first_backfill_run%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped P5 first-backfill initialization denied';
  END IF;
  IF p_measurement_evidence_sha256 IS NULL
     OR p_approval_ref_sha256 IS NULL
     OR p_authority_cutoff_at IS NULL
     OR p_measurement_evidence_sha256 <> v_measurement_sha
     OR p_approval_ref_sha256 <> v_approval_sha
     OR p_authority_cutoff_at <> v_cutoff THEN
    RAISE EXCEPTION 'P5 first-backfill authority does not match the approved measurement';
  END IF;

  INSERT INTO dna.dna_open_lab_p5_first_backfill_run (
    owner_id, measurement_evidence_sha256, approval_ref_sha256,
    authority_cutoff_at, revision, status, next_request_ordinal,
    logical_request_count, retained_r2_bytes,
    omitted_identity_observation_count, completion_sha256
  ) VALUES (
    p_owner_id, v_measurement_sha, v_approval_sha, v_cutoff,
    1, 'running', 1, 0, 0, 0, NULL
  )
  ON CONFLICT (owner_id, measurement_evidence_sha256) DO NOTHING;

  SELECT stored.* INTO STRICT v_run
  FROM dna.dna_open_lab_p5_first_backfill_run stored
  WHERE stored.owner_id = p_owner_id
    AND stored.measurement_evidence_sha256 = v_measurement_sha;
  IF v_run.approval_ref_sha256 <> v_approval_sha
     OR v_run.authority_cutoff_at <> v_cutoff THEN
    RAISE EXCEPTION 'P5 first-backfill stored authority drifted';
  END IF;

  RETURN QUERY SELECT v_run.revision, v_run.status,
    v_run.next_request_ordinal, v_run.logical_request_count,
    v_run.retained_r2_bytes, v_run.omitted_identity_observation_count,
    v_run.completion_sha256;
END
$function$;

CREATE FUNCTION dna.record_dna_open_lab_p5_first_backfill_receipt(
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
     OR p_request_ordinal NOT BETWEEN 1 AND 17453
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
  IF v_run.retained_r2_bytes + p_byte_length > 1151071826 THEN
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

CREATE FUNCTION dna.complete_dna_open_lab_p5_first_backfill_run(
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
  IF v_run.logical_request_count <> 17453
     OR v_run.next_request_ordinal <> 17454
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

CREATE FUNCTION dna.read_dna_open_lab_p5_first_backfill_run(
  p_owner_id uuid,
  p_measurement_evidence_sha256 text
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
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped P5 first-backfill run read denied';
  END IF;
  RETURN QUERY
  SELECT stored.revision, stored.status, stored.next_request_ordinal,
    stored.logical_request_count, stored.retained_r2_bytes,
    stored.omitted_identity_observation_count, stored.completion_sha256
  FROM dna.dna_open_lab_p5_first_backfill_run stored
  WHERE stored.owner_id = p_owner_id
    AND stored.measurement_evidence_sha256 = p_measurement_evidence_sha256;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_p5_first_backfill_receipts(
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
     OR p_after_request_ordinal NOT BETWEEN 0 AND 17453
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

REVOKE ALL ON TABLE dna.dna_open_lab_p5_first_backfill_run FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_p5_first_backfill_request_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.initialize_dna_open_lab_p5_first_backfill_run(
  uuid, text, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_dna_open_lab_p5_first_backfill_receipt(
  uuid, text, bigint, integer, text, timestamptz, text, integer, text,
  integer, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.complete_dna_open_lab_p5_first_backfill_run(
  uuid, text, bigint, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_p5_first_backfill_run(
  uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_p5_first_backfill_receipts(
  uuid, text, integer, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.initialize_dna_open_lab_p5_first_backfill_run(
  uuid, text, text, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_dna_open_lab_p5_first_backfill_receipt(
  uuid, text, bigint, integer, text, timestamptz, text, integer, text,
  integer, boolean
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.complete_dna_open_lab_p5_first_backfill_run(
  uuid, text, bigint, text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_p5_first_backfill_run(
  uuid, text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_p5_first_backfill_receipts(
  uuid, text, integer, integer
) TO dna_app_runtime;

COMMIT;
