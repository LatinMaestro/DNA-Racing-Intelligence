BEGIN;

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'synthetic-owner-1'
);

DO $retired_source$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.reserve_import_upload_batch(
      '11111111-1111-4111-8111-111111111111',
      'retired-vault-upload',
      repeat('6', 64)::character(64),
      '2026-08-10T01:00:00.000Z',
      jsonb_build_array(
        jsonb_build_object(
          'client_file_id', 'retired-vault-1',
          'source_family', 'current_vault',
          'original_file_name', 'synthetic-retired-vault.csv',
          'content_type', 'text/csv',
          'byte_length', 128,
          'sha256', repeat('7', 64)
        )
      )
    );
    RAISE EXCEPTION 'retired Current Vault upload was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM dna.import_upload_batch
    WHERE idempotency_key = 'retired-vault-upload'
  ) THEN
    RAISE EXCEPTION 'rejected Current Vault upload left durable state';
  END IF;
END
$retired_source$;

DO $eight_file_contract$
DECLARE
  v_files jsonb;
  v_reserved record;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'client_file_id', 'approved-' || item.number,
      'source_family', CASE
        WHEN item.number <= 6 THEN 'race_merge'
        WHEN item.number = 7 THEN 'core_details'
        ELSE 'current_arena'
      END,
      'original_file_name', 'synthetic-approved-' || item.number || '.csv',
      'content_type', 'text/csv',
      'byte_length', 256,
      'sha256', repeat(substr('89abcdef', item.number, 1), 64)
    ) ORDER BY item.number
  )
  INTO v_files
  FROM generate_series(1, 8) AS item(number);

  SELECT * INTO v_reserved
  FROM dna.reserve_import_upload_batch(
    '11111111-1111-4111-8111-111111111111',
    'approved-eight-files',
    repeat('8', 64)::character(64),
    '2026-08-10T01:01:00.000Z',
    v_files
  );

  IF
    v_reserved.disposition <> 'created'
    OR jsonb_array_length(v_reserved.reserved_files) <> 8
  THEN
    RAISE EXCEPTION 'approved eight-file upload was not reserved completely';
  END IF;

  BEGIN
    SELECT jsonb_agg(
      jsonb_build_object(
        'client_file_id', 'too-many-' || item.number,
        'source_family', 'race_merge',
        'original_file_name', 'synthetic-too-many-' || item.number || '.csv',
        'content_type', 'text/csv',
        'byte_length', 256,
        'sha256', repeat('9', 64)
      ) ORDER BY item.number
    )
    INTO v_files
    FROM generate_series(1, 9) AS item(number);

    PERFORM *
    FROM dna.reserve_import_upload_batch(
      '11111111-1111-4111-8111-111111111111',
      'rejected-nine-files',
      repeat('9', 64)::character(64),
      '2026-08-10T01:02:00.000Z',
      v_files
    );
    RAISE EXCEPTION 'nine-file upload was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'nine-file upload was accepted' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM dna.import_upload_batch
    WHERE idempotency_key = 'rejected-nine-files'
  ) THEN
    RAISE EXCEPTION 'rejected nine-file upload left durable state';
  END IF;
END
$eight_file_contract$;

ROLLBACK;
