BEGIN;

SET LOCAL app.owner_id = '53000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '53000000-0000-4000-8000-000000000001',
  'synthetic_dataset_version_evidence_owner'
);

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '53000000-0000-4000-8000-000000000101',
  '53000000-0000-4000-8000-000000000001',
  'core_details', 'Core Details.csv', repeat('1', 64),
  'utf_8', 'core-details/v1', 'validating',
  '2026-08-24T10:00:00Z', 2, 0, 0, 0
);

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number, natural_key,
  fingerprint_sha256, status
) VALUES
  (
    '53000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000101',
    1, 'core-evidence-1', repeat('2', 64), 'ready'
  ),
  (
    '53000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000101',
    2, 'core-evidence-2', repeat('3', 64), 'ready'
  );

SELECT * FROM dna.register_dataset_evidence_object(
  '53000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000101',
  'core_details', 'staged_rows', 0, 'ndjson_gzip',
  'owners/synthetic/evidence/core-evidence-part-0000.ndjson.gz',
  repeat('4', 64), 100, 1, 'core-evidence-1', 'core-evidence-1',
  '2026-08-24T10:00:10Z'
);
SELECT * FROM dna.register_dataset_evidence_object(
  '53000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000101',
  'core_details', 'staged_rows', 1, 'ndjson_gzip',
  'owners/synthetic/evidence/core-evidence-part-0001.ndjson.gz',
  repeat('5', 64), 120, 1, 'core-evidence-2', 'core-evidence-2',
  '2026-08-24T10:00:11Z'
);

DO $accept_and_refresh$
DECLARE
  v_accept record;
BEGIN
  SELECT * INTO STRICT v_accept
  FROM dna.accept_staged_dataset(
    '53000000-0000-4000-8000-000000000101',
    '53000000-0000-4000-8000-000000000201',
    '2026-08-24T10:01:00Z',
    '2026-08-24T10:02:00Z',
    '2026-08-24T10:00:00Z'
  );
  IF v_accept.result_status <> 'accepted'
     OR v_accept.activated_version_number <> 1 THEN
    RAISE EXCEPTION 'dataset version evidence fixture was not accepted';
  END IF;

  UPDATE dna.dataset_version
  SET aggregate_refreshed_at = '2026-08-24T10:03:00Z'
  WHERE owner_id = '53000000-0000-4000-8000-000000000001'
    AND id = '53000000-0000-4000-8000-000000000201';

  UPDATE dna.aggregate_refresh_job
  SET status = 'completed',
      started_at = '2026-08-24T10:02:30Z',
      completed_at = '2026-08-24T10:03:00Z',
      affected_record_count = 2
  WHERE owner_id = '53000000-0000-4000-8000-000000000001'
    AND dataset_version_id = '53000000-0000-4000-8000-000000000201';
END
$accept_and_refresh$;

DO $seal_and_replay$
DECLARE
  v_result record;
  v_replay record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.seal_dataset_version_evidence(
    '53000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000201',
    '2026-08-24T10:04:00Z'
  );

  IF v_result.status <> 'sealed'
     OR v_result.evidence_kind <> 'staged_rows'
     OR v_result.evidence_partition_count <> 2
     OR v_result.evidence_row_count <> 2
     OR v_result.evidence_byte_size <> 220 THEN
    RAISE EXCEPTION 'dataset version evidence receipt is incorrect';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM dna.seal_dataset_version_evidence(
    '53000000-0000-4000-8000-000000000001',
    '53000000-0000-4000-8000-000000000201',
    '2026-08-24T10:05:00Z'
  );

  IF v_replay.status <> 'existing'
     OR v_replay.evidence_kind <> 'staged_rows'
     OR v_replay.evidence_partition_count <> 2
     OR v_replay.evidence_row_count <> 2
     OR v_replay.evidence_byte_size <> 220 THEN
    RAISE EXCEPTION 'dataset version evidence receipt replay is not idempotent';
  END IF;
END
$seal_and_replay$;

DO $receipt_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_version_evidence_receipt receipt
    WHERE receipt.owner_id = '53000000-0000-4000-8000-000000000001'
      AND receipt.dataset_version_id = '53000000-0000-4000-8000-000000000201'
      AND receipt.import_batch_id = '53000000-0000-4000-8000-000000000101'
      AND receipt.source_type = 'core_details'
      AND receipt.evidence_kind = 'staged_rows'
      AND receipt.evidence_partition_count = 2
      AND receipt.evidence_row_count = 2
      AND receipt.evidence_byte_size = 220
      AND receipt.sealed_at = '2026-08-24T10:04:00Z'
  ) THEN
    RAISE EXCEPTION 'durable dataset version evidence receipt is unavailable';
  END IF;

  IF NOT has_table_privilege(
    'dna_app_runtime', 'dna.dataset_version_evidence_receipt', 'SELECT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dataset_version_evidence_receipt', 'INSERT'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dataset_version_evidence_receipt', 'UPDATE'
  ) OR has_table_privilege(
    'dna_app_runtime', 'dna.dataset_version_evidence_receipt', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'dataset version evidence receipt privileges are not least-privileged';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.seal_dataset_version_evidence(uuid,uuid,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'dataset version evidence sealing privilege is unavailable';
  END IF;
END
$receipt_assertions$;

DO $owner_isolation$
BEGIN
  PERFORM set_config(
    'app.owner_id',
    '53000000-0000-4000-8000-000000000099',
    true
  );
  BEGIN
    PERFORM dna.seal_dataset_version_evidence(
      '53000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000201',
      '2026-08-24T10:06:00Z'
    );
    RAISE EXCEPTION 'cross-owner evidence sealing was not rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'cross-owner evidence sealing was not rejected' THEN
        RAISE;
      END IF;
  END;
  PERFORM set_config(
    'app.owner_id',
    '53000000-0000-4000-8000-000000000001',
    true
  );
END
$owner_isolation$;

ROLLBACK;
