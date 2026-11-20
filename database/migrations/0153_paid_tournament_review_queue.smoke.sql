BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1530000-0000-4000-8000-000000000001', 'smoke_paid_review_owner'),
  ('a1530000-0000-4000-8000-000000000002', 'smoke_paid_review_other');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  schema_version, status, uploaded_at, import_completed_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  'a1530000-0000-4000-8000-000000000010',
  'a1530000-0000-4000-8000-000000000001',
  'core_details', 'paid-review-smoke.csv', repeat('a', 64),
  'smoke-v1', 'accepted', '2026-11-19T00:00:00Z',
  '2026-11-19T00:01:00Z', 1, 1, 0, 0
);

INSERT INTO dna.core (
  id, owner_id, source_core_id, display_name, core_class, element,
  f_number, sex, source_import_batch_id
) VALUES (
  'a1530000-0000-4000-8000-000000000020',
  'a1530000-0000-4000-8000-000000000001',
  '10457', 'Paid Review Core', 'Genesis', 'Fire',
  1, 'female', 'a1530000-0000-4000-8000-000000000010'
);

INSERT INTO dna.owner_vault_core (
  id, owner_id, core_id, in_my_vault, me_eligible, version,
  created_at, updated_at
) VALUES (
  'a1530000-0000-4000-8000-000000000030',
  'a1530000-0000-4000-8000-000000000001',
  'a1530000-0000-4000-8000-000000000020',
  true, true, 1, '2026-11-19T00:02:00Z', '2026-11-19T00:02:00Z'
);

INSERT INTO dna.tournament_configuration (
  owner_id, tournament_id, tournament_label, bracket_id, split_label,
  mode, eligible_distances_metres, discovery_relevance,
  qualification_metric_label, configuration_version,
  candidate_snapshot_version, updated_at
) VALUES (
  'a1530000-0000-4000-8000-000000000001',
  'tournament-smoke', 'Tournament Smoke', 'segment-smoke', 'Smoke Segment',
  'bike', ARRAY[1200], 'eligible', 'median_time', 'config-v1',
  'snapshot-v1', '2026-11-19T00:03:00Z'
);

INSERT INTO dna.tournament_core_selection (
  owner_id, tournament_id, bracket_id, configuration_version,
  candidate_snapshot_version, core_ids, updated_at
) VALUES (
  'a1530000-0000-4000-8000-000000000001',
  'tournament-smoke', 'segment-smoke', 'config-v1', 'snapshot-v1',
  ARRAY['10457'], '2026-11-19T00:04:00Z'
);

DO $permissions$
BEGIN
  IF has_table_privilege('dna_app_runtime',
      'dna.paid_tournament_review_queue', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('dna_app_runtime',
      'dna.paid_tournament_review_event', 'SELECT,INSERT,UPDATE,DELETE')
    OR has_sequence_privilege('dna_app_runtime',
      'dna.paid_tournament_review_event_event_id_seq', 'USAGE,SELECT,UPDATE')
    OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid = 'dna.paid_tournament_review_queue'::regclass)
    OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid = 'dna.paid_tournament_review_event'::regclass)
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.enqueue_paid_tournament_review(uuid,uuid,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,timestamptz,timestamptz)',
      'EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_paid_tournament_review_queue(uuid,integer)', 'EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
      'dna.read_paid_tournament_review_events(uuid,uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'paid Tournament review queue security is unsafe';
  END IF;
END
$permissions$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = 'a1530000-0000-4000-8000-000000000001';

DO $queue$
DECLARE
  v_owner constant uuid := 'a1530000-0000-4000-8000-000000000001';
  v_queue constant uuid := 'a1530000-0000-4000-8000-000000000100';
  v_field constant text := repeat('b', 64);
  v_evaluation constant text := repeat('c', 64);
BEGIN
  PERFORM * FROM dna.enqueue_paid_tournament_review(
    v_owner, v_queue, 'tournament-smoke', 'segment-smoke', 'config-v1',
    'snapshot-v1', 'race-001', '10457', 'intent-001',
    'provisional_candidate', v_field, v_evaluation,
    '2026-11-19T01:00:00Z', '2026-11-19T01:10:00Z', 'consent-v1',
    '2026-11-19T01:11:00Z', '2026-11-19T01:12:00Z');

  IF (SELECT count(*) FROM dna.read_paid_tournament_review_queue(v_owner, 100)) <> 1
    OR (SELECT game_entry_allowed FROM dna.read_paid_tournament_review_queue(
      v_owner, 100))
    OR (SELECT state FROM dna.read_paid_tournament_review_queue(v_owner, 100))
      IS DISTINCT FROM 'review_required'
    OR (SELECT reconciliation_status
      FROM dna.read_paid_tournament_review_queue(v_owner, 100))
      IS DISTINCT FROM 'required'
    OR (SELECT count(*) FROM dna.read_paid_tournament_review_events(
      v_owner, v_queue)) <> 1
  THEN
    RAISE EXCEPTION 'paid Tournament review queue did not remain review-only';
  END IF;

  PERFORM * FROM dna.enqueue_paid_tournament_review(
    v_owner, v_queue, 'tournament-smoke', 'segment-smoke', 'config-v1',
    'snapshot-v1', 'race-001', '10457', 'intent-001',
    'provisional_candidate', v_field, v_evaluation,
    '2026-11-19T01:00:00Z', '2026-11-19T01:10:00Z', 'consent-v1',
    '2026-11-19T01:11:00Z', '2026-11-19T01:12:00Z');
  IF (SELECT count(*) FROM dna.read_paid_tournament_review_events(
      v_owner, v_queue)) <> 1 THEN
    RAISE EXCEPTION 'idempotent paid Tournament review duplicated its audit event';
  END IF;

  BEGIN
    PERFORM * FROM dna.enqueue_paid_tournament_review(
      v_owner, v_queue, 'tournament-smoke', 'segment-smoke', 'config-v1',
      'snapshot-v1', 'race-001', '10457', 'intent-001',
      'provisional_candidate', v_field, repeat('d', 64),
      '2026-11-19T01:00:00Z', '2026-11-19T01:10:00Z', 'consent-v1',
      '2026-11-19T01:11:00Z', '2026-11-19T01:12:00Z');
    RAISE EXCEPTION 'altered idempotent paid Tournament review was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'altered idempotent paid Tournament review was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.enqueue_paid_tournament_review(
      v_owner, 'a1530000-0000-4000-8000-000000000101',
      'tournament-smoke', 'segment-smoke', 'config-v1', 'snapshot-v1',
      'race-001', '10457', 'intent-002', 'provisional_candidate',
      v_field, v_evaluation, '2026-11-19T01:00:00Z',
      '2026-11-19T01:10:00Z', 'consent-v1', '2026-11-19T01:11:00Z',
      '2026-11-19T01:12:00Z');
    RAISE EXCEPTION 'second owned Core reservation for one race was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'second owned Core reservation for one race was accepted' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.enqueue_paid_tournament_review(
      v_owner, 'a1530000-0000-4000-8000-000000000102',
      'tournament-smoke', 'segment-smoke', 'config-v1', 'snapshot-v1',
      'race-002', '10457', 'intent-003', 'avoid',
      v_field, v_evaluation, '2026-11-19T01:00:00Z',
      '2026-11-19T01:10:00Z', 'consent-v1', '2026-11-19T01:11:00Z',
      '2026-11-19T01:12:00Z');
    RAISE EXCEPTION 'avoid decision was accepted into the review queue';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'avoid decision was accepted into the review queue' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.enqueue_paid_tournament_review(
      v_owner, 'a1530000-0000-4000-8000-000000000103',
      'tournament-smoke', 'segment-smoke', 'config-v1', 'snapshot-v1',
      'race-003', '99999', 'intent-004', 'provisional_candidate',
      v_field, v_evaluation, '2026-11-19T01:00:00Z',
      '2026-11-19T01:10:00Z', 'consent-v1', '2026-11-19T01:11:00Z',
      '2026-11-19T01:12:00Z');
    RAISE EXCEPTION 'unselected Core was accepted into the review queue';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'unselected Core was accepted into the review queue' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM dna.read_paid_tournament_review_queue(
      'a1530000-0000-4000-8000-000000000002', 100);
    RAISE EXCEPTION 'cross-owner paid Tournament review read was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'cross-owner paid Tournament review read was accepted' THEN RAISE; END IF;
  END;
END
$queue$;

RESET ROLE;
ROLLBACK;
