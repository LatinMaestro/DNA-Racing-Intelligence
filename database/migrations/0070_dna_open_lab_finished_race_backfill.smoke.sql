BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id) VALUES
  ('70000000-0000-4000-8000-000000000001', 'synthetic_backfill_owner'),
  ('70000000-0000-4000-8000-000000000002', 'synthetic_backfill_other');

SET LOCAL app.owner_id = '70000000-0000-4000-8000-000000000001';

DO $checkpoint_lifecycle$
DECLARE
  v_revision bigint;
  v_checkpoint jsonb;
  v_initial jsonb := '{
    "version":1,
    "rootWindow":{
      "startTime":"2026-08-01T00:00:00.000Z",
      "endTime":"2026-08-01T00:00:10.000Z"
    },
    "pendingWindows":[{
      "startTime":"2026-08-01T00:00:00.000Z",
      "endTime":"2026-08-01T00:00:10.000Z"
    }],
    "minimumWindowMilliseconds":1,
    "completedWindowCount":0,
    "splitCount":0,
    "successfulFinishedRaceRequestCount":0,
    "raceDocumentRequestCount":0,
    "publishedWindowDocumentCount":0
  }'::jsonb;
  v_split jsonb := '{
    "version":1,
    "rootWindow":{
      "startTime":"2026-08-01T00:00:00.000Z",
      "endTime":"2026-08-01T00:00:10.000Z"
    },
    "pendingWindows":[
      {
        "startTime":"2026-08-01T00:00:00.000Z",
        "endTime":"2026-08-01T00:00:05.000Z"
      },
      {
        "startTime":"2026-08-01T00:00:05.000Z",
        "endTime":"2026-08-01T00:00:10.000Z"
      }
    ],
    "minimumWindowMilliseconds":1,
    "completedWindowCount":0,
    "splitCount":1,
    "successfulFinishedRaceRequestCount":1,
    "raceDocumentRequestCount":0,
    "publishedWindowDocumentCount":0
  }'::jsonb;
  v_left_published jsonb := '{
    "version":1,
    "rootWindow":{
      "startTime":"2026-08-01T00:00:00.000Z",
      "endTime":"2026-08-01T00:00:10.000Z"
    },
    "pendingWindows":[{
      "startTime":"2026-08-01T00:00:05.000Z",
      "endTime":"2026-08-01T00:00:10.000Z"
    }],
    "minimumWindowMilliseconds":1,
    "completedWindowCount":1,
    "splitCount":1,
    "successfulFinishedRaceRequestCount":2,
    "raceDocumentRequestCount":1,
    "publishedWindowDocumentCount":1
  }'::jsonb;
  v_complete jsonb := '{
    "version":1,
    "rootWindow":{
      "startTime":"2026-08-01T00:00:00.000Z",
      "endTime":"2026-08-01T00:00:10.000Z"
    },
    "pendingWindows":[],
    "minimumWindowMilliseconds":1,
    "completedWindowCount":2,
    "splitCount":1,
    "successfulFinishedRaceRequestCount":3,
    "raceDocumentRequestCount":1,
    "publishedWindowDocumentCount":1
  }'::jsonb;
  v_left_publication jsonb := jsonb_build_object(
    'window', jsonb_build_object(
      'startTime', '2026-08-01T00:00:00.000Z',
      'endTime', '2026-08-01T00:00:05.000Z'
    ),
    'receipt', jsonb_build_object(
      'windowKey', repeat('1', 64),
      'contentSha256', repeat('2', 64),
      'documentCount', 1,
      'manifestObjectKey', 'dna-open-lab/v1/' || repeat('a', 64)
        || '/races/finished-windows/' || repeat('1', 64) || '.json',
      'manifestBodySha256', repeat('3', 64),
      'manifestByteLength', 256
    )
  );
  v_right_publication jsonb := jsonb_build_object(
    'window', jsonb_build_object(
      'startTime', '2026-08-01T00:00:05.000Z',
      'endTime', '2026-08-01T00:00:10.000Z'
    ),
    'receipt', jsonb_build_object(
      'windowKey', repeat('4', 64),
      'contentSha256', repeat('5', 64),
      'documentCount', 0,
      'manifestObjectKey', 'dna-open-lab/v1/' || repeat('a', 64)
        || '/races/finished-windows/' || repeat('4', 64) || '.json',
      'manifestBodySha256', repeat('6', 64),
      'manifestByteLength', 192
    )
  );
BEGIN
  SELECT saved.revision, saved.checkpoint
  INTO v_revision, v_checkpoint
  FROM dna.save_dna_open_lab_finished_race_backfill_checkpoint(
    '70000000-0000-4000-8000-000000000001', NULL, v_initial, NULL
  ) saved;
  IF v_revision <> 1 OR v_checkpoint <> v_initial THEN
    RAISE EXCEPTION 'initial finished-race checkpoint was not stored';
  END IF;

  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_backfill_checkpoint(
    '70000000-0000-4000-8000-000000000001', NULL, v_initial, NULL
  ) saved;
  IF v_revision <> 1 THEN
    RAISE EXCEPTION 'initial finished-race checkpoint replay was not idempotent';
  END IF;

  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_backfill_checkpoint(
    '70000000-0000-4000-8000-000000000001', 1, v_split, NULL
  ) saved;
  IF v_revision <> 2 THEN
    RAISE EXCEPTION 'finished-race split checkpoint was not advanced';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.save_dna_open_lab_finished_race_backfill_checkpoint(
      '70000000-0000-4000-8000-000000000001', 2,
      v_left_published, NULL
    );
    RAISE EXCEPTION 'finished-race checkpoint advanced without R2 receipt';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'finished-race checkpoint advanced without R2 receipt' THEN
      RAISE;
    END IF;
  END;

  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_backfill_checkpoint(
    '70000000-0000-4000-8000-000000000001', 2,
    v_left_published, v_left_publication
  ) saved;
  IF v_revision <> 3 THEN
    RAISE EXCEPTION 'finished-race publication did not atomically advance';
  END IF;

  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_backfill_checkpoint(
    '70000000-0000-4000-8000-000000000001', 2,
    v_left_published, v_left_publication
  ) saved;
  IF v_revision <> 3 THEN
    RAISE EXCEPTION 'finished-race publication replay was not idempotent';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.save_dna_open_lab_finished_race_backfill_checkpoint(
      '70000000-0000-4000-8000-000000000001', 2,
      v_left_published,
      jsonb_set(v_left_publication, '{receipt,contentSha256}',
        to_jsonb(repeat('9', 64)))
    );
    RAISE EXCEPTION 'conflicting finished-race receipt replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting finished-race receipt replay was accepted' THEN
      RAISE;
    END IF;
  END;

  SELECT saved.revision INTO v_revision
  FROM dna.save_dna_open_lab_finished_race_backfill_checkpoint(
    '70000000-0000-4000-8000-000000000001', 3,
    v_complete, v_right_publication
  ) saved;
  IF v_revision <> 4 THEN
    RAISE EXCEPTION 'finished-race empty-window receipt was not accepted';
  END IF;

  SELECT stored.revision, stored.checkpoint
  INTO v_revision, v_checkpoint
  FROM dna.read_dna_open_lab_finished_race_backfill_checkpoint(
    '70000000-0000-4000-8000-000000000001'
  ) stored;
  IF v_revision <> 4 OR v_checkpoint <> v_complete THEN
    RAISE EXCEPTION 'finished-race checkpoint read is incorrect';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.read_dna_open_lab_finished_race_window_receipt(
      '70000000-0000-4000-8000-000000000001', repeat('1', 64)
    )
  ) <> 1 OR (
    SELECT count(*)
    FROM dna.read_dna_open_lab_finished_race_window_receipt(
      '70000000-0000-4000-8000-000000000001', repeat('4', 64)
    )
  ) <> 1 THEN
    RAISE EXCEPTION 'finished-race publication receipt ledger is incomplete';
  END IF;
END
$checkpoint_lifecycle$;

SET LOCAL app.owner_id = '70000000-0000-4000-8000-000000000002';

DO $owner_guard$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.read_dna_open_lab_finished_race_backfill_checkpoint(
      '70000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner finished-race checkpoint was readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner finished-race checkpoint was readable' THEN
      RAISE;
    END IF;
  END;
END
$owner_guard$;

ROLLBACK;
