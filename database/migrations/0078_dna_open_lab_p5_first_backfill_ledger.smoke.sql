BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('78000000-0000-4000-8000-000000000001', 'synthetic_p5_backfill_owner'),
  ('78000000-0000-4000-8000-000000000002', 'synthetic_p5_backfill_other');

DO $privileges$
BEGIN
  IF has_table_privilege(
    'dna_app_runtime', 'dna.dna_open_lab_p5_first_backfill_run', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime',
    'dna.dna_open_lab_p5_first_backfill_request_receipt', 'SELECT'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.initialize_dna_open_lab_p5_first_backfill_run(uuid,text,text,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.record_dna_open_lab_p5_first_backfill_receipt(uuid,text,bigint,integer,text,timestamp with time zone,text,integer,text,integer,boolean)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.complete_dna_open_lab_p5_first_backfill_run(uuid,text,bigint,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'P5 first-backfill ledger runtime privileges are unsafe';
  END IF;
END
$privileges$;

SET LOCAL app.owner_id = '78000000-0000-4000-8000-000000000001';

DO $ledger_lifecycle$
DECLARE
  v_owner constant uuid := '78000000-0000-4000-8000-000000000001';
  v_measurement constant text :=
    '250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4';
  v_approval constant text :=
    'ea4f931d740ee2085cec4300924a6acf663a6484fc18cda32258034807984a40';
  v_revision bigint;
  v_status text;
  v_next integer;
  v_count integer;
  v_bytes bigint;
  v_omissions integer;
  v_completion text;
BEGIN
  SELECT initialized.revision, initialized.status,
    initialized.next_request_ordinal, initialized.logical_request_count,
    initialized.retained_r2_bytes,
    initialized.omitted_identity_observation_count,
    initialized.completion_sha256
  INTO v_revision, v_status, v_next, v_count, v_bytes, v_omissions,
    v_completion
  FROM dna.initialize_dna_open_lab_p5_first_backfill_run(
    v_owner, v_measurement, v_approval, '2026-09-02T00:11:55.961Z'
  ) initialized;
  IF (v_revision, v_status, v_next, v_count, v_bytes, v_omissions,
      v_completion) IS DISTINCT FROM
     (1::bigint, 'running'::text, 1, 0, 0::bigint, 0, NULL::text) THEN
    RAISE EXCEPTION 'P5 first-backfill ledger was not initialized exactly';
  END IF;

  PERFORM * FROM dna.initialize_dna_open_lab_p5_first_backfill_run(
    v_owner, v_measurement, v_approval, '2026-09-02T00:11:55.961Z'
  );
  BEGIN
    PERFORM * FROM dna.initialize_dna_open_lab_p5_first_backfill_run(
      v_owner, repeat('f', 64), v_approval, '2026-09-02T00:11:55.961Z'
    );
    RAISE EXCEPTION 'P5 first-backfill measurement drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'P5 first-backfill measurement drift was accepted' THEN RAISE; END IF;
  END;

  SELECT recorded.revision, recorded.next_request_ordinal,
    recorded.logical_request_count, recorded.retained_r2_bytes,
    recorded.omitted_identity_observation_count
  INTO v_revision, v_next, v_count, v_bytes, v_omissions
  FROM dna.record_dna_open_lab_p5_first_backfill_receipt(
    v_owner, v_measurement, 1, 1, 'finished_races',
    '2026-09-02T04:00:00Z', repeat('1', 64), 100,
    'dna-open-lab/v1/' || repeat('a', 64)
      || '/first-private-preview-backfill/' || v_measurement
      || '/requests/000001.json',
    1, true
  ) recorded;
  IF (v_revision, v_next, v_count, v_bytes, v_omissions) <>
     (2::bigint, 2, 1, 100::bigint, 1) THEN
    RAISE EXCEPTION 'P5 first-backfill receipt did not advance atomically';
  END IF;

  SELECT recorded.revision INTO v_revision
  FROM dna.record_dna_open_lab_p5_first_backfill_receipt(
    v_owner, v_measurement, 1, 1, 'finished_races',
    '2026-09-02T04:00:00Z', repeat('1', 64), 100,
    'dna-open-lab/v1/' || repeat('a', 64)
      || '/first-private-preview-backfill/' || v_measurement
      || '/requests/000001.json',
    1, true
  ) recorded;
  IF v_revision <> 2 THEN
    RAISE EXCEPTION 'P5 first-backfill exact replay was not idempotent';
  END IF;

  BEGIN
    PERFORM * FROM dna.record_dna_open_lab_p5_first_backfill_receipt(
      v_owner, v_measurement, 2, 1, 'finished_races',
      '2026-09-02T04:00:00Z', repeat('2', 64), 100,
      'dna-open-lab/v1/' || repeat('a', 64)
        || '/first-private-preview-backfill/' || v_measurement
        || '/requests/000001.json',
      1, true
    );
    RAISE EXCEPTION 'P5 first-backfill conflicting replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'P5 first-backfill conflicting replay was accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.record_dna_open_lab_p5_first_backfill_receipt(
      v_owner, v_measurement, 2, 3, 'race_activity',
      '2026-09-02T04:00:01Z', repeat('3', 64), 1,
      'dna-open-lab/v1/' || repeat('a', 64)
        || '/first-private-preview-backfill/' || v_measurement
        || '/requests/000003.json',
      0, false
    );
    RAISE EXCEPTION 'P5 first-backfill out-of-order receipt was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'P5 first-backfill out-of-order receipt was accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.record_dna_open_lab_p5_first_backfill_receipt(
      v_owner, v_measurement, 2, 2, 'finished_races',
      '2026-09-02T04:00:01Z', repeat('2', 64), 1,
      'dna-open-lab/v1/' || repeat('a', 64)
        || '/first-private-preview-backfill/' || v_measurement
        || '/requests/000002.json',
      1, true
    );
    RAISE EXCEPTION 'P5 first-backfill omission overflow was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'P5 first-backfill omission overflow was accepted' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM dna.read_dna_open_lab_p5_first_backfill_receipts(
    v_owner, v_measurement, 0, 500
  )) <> 1 THEN
    RAISE EXCEPTION 'P5 first-backfill receipt page is incomplete';
  END IF;

  INSERT INTO dna.dna_open_lab_p5_first_backfill_request_receipt (
    owner_id, measurement_evidence_sha256, request_ordinal, family,
    observed_at, content_sha256, byte_length, evidence_object_key,
    omitted_identity_observation_count, quarantine_bound
  )
  SELECT v_owner, v_measurement, ordinal,
    CASE ordinal % 5
      WHEN 0 THEN 'race_activity'
      WHEN 1 THEN 'token_prices'
      WHEN 2 THEN 'vault_identity'
      WHEN 3 THEN 'core_current_state'
      ELSE 'splice_arena'
    END,
    '2026-09-02T04:00:01Z'::timestamptz,
    lpad(to_hex(ordinal), 64, '0'), 1,
    'dna-open-lab/v1/' || repeat('a', 64)
      || '/first-private-preview-backfill/' || v_measurement
      || '/requests/' || lpad(ordinal::text, 6, '0') || '.json',
    0, false
  FROM generate_series(2, 17452) ordinal;
  UPDATE dna.dna_open_lab_p5_first_backfill_run
  SET revision = 17453, next_request_ordinal = 17453,
      logical_request_count = 17452, retained_r2_bytes = 17551,
      updated_at = clock_timestamp()
  WHERE owner_id = v_owner AND measurement_evidence_sha256 = v_measurement;

  SELECT recorded.revision INTO v_revision
  FROM dna.record_dna_open_lab_p5_first_backfill_receipt(
    v_owner, v_measurement, 17453, 17453, 'splice_arena',
    '2026-09-02T04:00:02Z', repeat('f', 64), 1,
    'dna-open-lab/v1/' || repeat('a', 64)
      || '/first-private-preview-backfill/' || v_measurement
      || '/requests/017453.json',
    0, false
  ) recorded;
  IF v_revision <> 17454 THEN
    RAISE EXCEPTION 'P5 first-backfill final receipt did not advance';
  END IF;

  SELECT completed.revision, completed.status, completed.completion_sha256
  INTO v_revision, v_status, v_completion
  FROM dna.complete_dna_open_lab_p5_first_backfill_run(
    v_owner, v_measurement, 17454, repeat('c', 64)
  ) completed;
  IF (v_revision, v_status, v_completion) <>
     (17455::bigint, 'complete'::text, repeat('c', 64)) THEN
    RAISE EXCEPTION 'P5 first-backfill completion was not stored';
  END IF;
  SELECT completed.revision INTO v_revision
  FROM dna.complete_dna_open_lab_p5_first_backfill_run(
    v_owner, v_measurement, 17454, repeat('c', 64)
  ) completed;
  IF v_revision <> 17455 THEN
    RAISE EXCEPTION 'P5 first-backfill completion replay was not idempotent';
  END IF;
END
$ledger_lifecycle$;

SET LOCAL app.owner_id = '78000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM * FROM dna.read_dna_open_lab_p5_first_backfill_run(
      '78000000-0000-4000-8000-000000000001',
      '250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4'
    );
    RAISE EXCEPTION 'cross-owner P5 first-backfill run was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner P5 first-backfill run was readable' THEN RAISE; END IF;
  END;
END
$owner_guard$;

ROLLBACK;
