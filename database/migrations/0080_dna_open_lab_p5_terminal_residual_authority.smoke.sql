BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('80000000-0000-4000-8000-000000000001', 'synthetic_p5_terminal_owner');

DO $privileges$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.initialize_dna_open_lab_p5_first_backfill_terminal_run(uuid,text,text,timestamp with time zone,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.record_dna_open_lab_p5_first_backfill_terminal_receipt(uuid,text,bigint,integer,text,timestamp with time zone,text,integer,text,integer,boolean)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.complete_dna_open_lab_p5_first_backfill_terminal_run(uuid,text,bigint,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.read_dna_open_lab_p5_first_backfill_terminal_receipts(uuid,text,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'P5 terminal residual runtime privileges are incomplete';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '80000000-0000-4000-8000-000000000001';

DO $terminal_lifecycle$
DECLARE
  v_owner constant uuid := '80000000-0000-4000-8000-000000000001';
  v_measurement constant text :=
    '250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4';
  v_original_approval constant text :=
    'ea4f931d740ee2085cec4300924a6acf663a6484fc18cda32258034807984a40';
  v_amendment_approval constant text :=
    '506e9e8333ff494bdd303c925dc8e6fdab98f27e336a8b2ccedb06bd01beb11f';
  v_terminal_approval constant text :=
    'ef878c23bac0b2a46aa326eda97b6f1933eb49e218b3f0928dab4205b91b09bd';
  v_revision bigint;
  v_status text;
  v_next integer;
  v_count integer;
  v_completion text;
BEGIN
  SELECT initialized.revision, initialized.status,
    initialized.next_request_ordinal, initialized.logical_request_count
  INTO v_revision, v_status, v_next, v_count
  FROM dna.initialize_dna_open_lab_p5_first_backfill_terminal_run(
    v_owner, v_measurement, v_original_approval,
    '2026-09-02T00:11:55.961Z', v_amendment_approval, v_terminal_approval
  ) initialized;
  IF (v_revision, v_status, v_next, v_count) <>
     (1::bigint, 'running'::text, 1, 0) THEN
    RAISE EXCEPTION 'P5 terminal ledger was not initialized exactly';
  END IF;

  BEGIN
    PERFORM * FROM dna.initialize_dna_open_lab_p5_first_backfill_terminal_run(
      v_owner, v_measurement, v_original_approval,
      '2026-09-02T00:11:55.961Z', v_amendment_approval, repeat('f', 64)
    );
    RAISE EXCEPTION 'P5 terminal approval drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'P5 terminal approval drift was accepted' THEN RAISE; END IF;
  END;

  INSERT INTO dna.dna_open_lab_p5_first_backfill_request_receipt (
    owner_id, measurement_evidence_sha256, request_ordinal, family,
    observed_at, content_sha256, byte_length, evidence_object_key,
    omitted_identity_observation_count, quarantine_bound
  )
  SELECT v_owner, v_measurement, ordinal,
    CASE
      WHEN ordinal <= 17369 THEN 'finished_races'
      WHEN ordinal <= 17376 THEN 'race_activity'
      WHEN ordinal = 17377 THEN 'token_prices'
      WHEN ordinal <= 17381 THEN 'vault_identity'
      WHEN ordinal <= 17456 THEN 'core_current_state'
      ELSE 'splice_arena'
    END,
    '2026-09-07T06:44:54.594Z'::timestamptz,
    lpad(to_hex(ordinal), 64, '0'), 1,
    'dna-open-lab/v1/' || repeat('a', 64)
      || '/first-private-preview-backfill/' || v_measurement
      || '/requests/' || lpad(ordinal::text, 6, '0') || '.json',
    CASE WHEN ordinal = 1 THEN 1 ELSE 0 END,
    ordinal = 1
  FROM generate_series(1, 17456) ordinal;
  UPDATE dna.dna_open_lab_p5_first_backfill_run
  SET revision = 17457, next_request_ordinal = 17457,
      logical_request_count = 17456, retained_r2_bytes = 17456,
      omitted_identity_observation_count = 1,
      updated_at = clock_timestamp()
  WHERE owner_id = v_owner AND measurement_evidence_sha256 = v_measurement;

  FOR v_next IN 17457..17464 LOOP
    SELECT recorded.revision INTO v_revision
    FROM dna.record_dna_open_lab_p5_first_backfill_terminal_receipt(
      v_owner, v_measurement, v_next::bigint, v_next,
      CASE WHEN v_next <= 17461 THEN 'core_current_state' ELSE 'splice_arena' END,
      '2026-09-07T06:44:54.594Z', lpad(to_hex(v_next), 64, '0'), 1,
      'dna-open-lab/v1/' || repeat('a', 64)
        || '/first-private-preview-backfill/' || v_measurement
        || '/requests/' || lpad(v_next::text, 6, '0') || '.json',
      0, false
    ) recorded;
    IF v_revision <> v_next + 1 THEN
      RAISE EXCEPTION 'P5 terminal receipt did not advance exactly';
    END IF;
  END LOOP;

  BEGIN
    PERFORM * FROM dna.record_dna_open_lab_p5_first_backfill_terminal_receipt(
      v_owner, v_measurement, 17465, 17465, 'splice_arena',
      '2026-09-07T06:44:54.594Z', repeat('f', 64), 1,
      'dna-open-lab/v1/' || repeat('a', 64)
        || '/first-private-preview-backfill/' || v_measurement
        || '/requests/017465.json', 0, false
    );
    RAISE EXCEPTION 'P5 terminal receipt overflow was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'P5 terminal receipt overflow was accepted' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM dna.read_dna_open_lab_p5_first_backfill_terminal_receipts(
    v_owner, v_measurement, 17456, 500
  )) <> 8 THEN
    RAISE EXCEPTION 'P5 terminal receipt page is incomplete';
  END IF;

  SELECT completed.revision, completed.status, completed.completion_sha256
  INTO v_revision, v_status, v_completion
  FROM dna.complete_dna_open_lab_p5_first_backfill_terminal_run(
    v_owner, v_measurement, 17465, repeat('c', 64)
  ) completed;
  IF (v_revision, v_status, v_completion) <>
     (17466::bigint, 'complete'::text, repeat('c', 64)) THEN
    RAISE EXCEPTION 'P5 terminal completion was not stored';
  END IF;
END
$terminal_lifecycle$;

ROLLBACK;
