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

DO $rolling_series$
DECLARE
  v_files jsonb;
  v_reserved record;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'client_file_id', 'current-' || item.number,
      'source_family', CASE
        WHEN item.number <= 7 THEN 'race_merge'
        WHEN item.number = 8 THEN 'core_details'
        ELSE 'current_arena'
      END,
      'original_file_name', 'synthetic-current-' || item.number || '.csv',
      'content_type', 'text/csv',
      'byte_length', 256,
      'sha256', lpad(to_hex(item.number), 64, '0')
    ) ORDER BY item.number
  )
  INTO v_files
  FROM generate_series(1, 9) AS item(number);

  SELECT * INTO v_reserved
  FROM dna.reserve_import_upload_batch(
    '11111111-1111-4111-8111-111111111111',
    'approved-current-series',
    repeat('a', 64)::character(64),
    '2026-08-11T11:00:00.000Z',
    v_files
  );

  IF
    v_reserved.disposition <> 'created'
    OR jsonb_array_length(v_reserved.reserved_files) <> 9
  THEN
    RAISE EXCEPTION 'current rolling Race Merge set was not reserved completely';
  END IF;
END
$rolling_series$;

DO $bounded_series$
DECLARE
  v_files jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'client_file_id', 'bounded-' || item.number,
      'source_family', 'race_merge',
      'original_file_name', 'synthetic-bounded-' || item.number || '.csv',
      'content_type', 'text/csv',
      'byte_length', 256,
      'sha256', lpad(to_hex(item.number + 64), 64, '0')
    ) ORDER BY item.number
  )
  INTO v_files
  FROM generate_series(1, 25) AS item(number);

  BEGIN
    PERFORM *
    FROM dna.reserve_import_upload_batch(
      '11111111-1111-4111-8111-111111111111',
      'rejected-unbounded-series',
      repeat('b', 64)::character(64),
      '2026-08-11T11:01:00.000Z',
      v_files
    );
    RAISE EXCEPTION 'unbounded Race Merge set was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'unbounded Race Merge set was accepted' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM dna.import_upload_batch
    WHERE idempotency_key = 'rejected-unbounded-series'
  ) THEN
    RAISE EXCEPTION 'rejected unbounded series left durable state';
  END IF;
END
$bounded_series$;

ROLLBACK;
