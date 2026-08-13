BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('31000000-0000-4000-8000-000000000001', 'synthetic_campaign_owner'),
  ('31000000-0000-4000-8000-000000000002', 'synthetic_campaign_other');

SET LOCAL app.owner_id = '31000000-0000-4000-8000-000000000001';

CREATE TEMP TABLE initial AS
SELECT * FROM dna.upsert_complete_tournament_configuration(
  '31000000-0000-4000-8000-000000000001',
  'campaign-cup', 'Campaign Cup', 'Season 12',
  '2026-09-01T00:00:00Z', '2026-09-07T00:00:00Z',
  'bike-a', 'Bike A', 'bike', ARRAY[1200], 4, 0.01, 'USD',
  'paid qualification', ARRAY['Genesis'], ARRAY['Bike'], ARRAY['Fire'],
  ARRAY[1], '[]'::jsonb, '[]'::jsonb, 'none', '[]'::jsonb,
  5, 3, NULL, 'fastest_single_time', NULL, '{}'::jsonb, '{}'::jsonb,
  'separate', 'eligible', 'confirmed', 'Synthetic rule.',
  'Rules screenshot.', '{"source":"owner_entry"}'::jsonb,
  '{
    "kind":"review_only_free_text",
    "action":"Review candidates",
    "ownerAcknowledgedAt":null,
    "evidence":null
  }'::jsonb
);

UPDATE dna.tournament_configuration
SET candidate_snapshot_version = 'snapshot-11111111111111111111111111111111'
WHERE owner_id = '31000000-0000-4000-8000-000000000001'
  AND tournament_id = 'campaign-cup' AND bracket_id = 'bike-a';

CREATE TEMP TABLE acknowledgement AS
SELECT * FROM dna.acknowledge_tournament_campaign_action(
  '31000000-0000-4000-8000-000000000001',
  'campaign-cup', 'bike-a',
  (SELECT configuration_version FROM initial),
  'snapshot-11111111111111111111111111111111',
  'Review the strongest eligible candidates.',
  'Owner reviewed the confirmed rules and current candidate snapshot.'
);

DO $bound$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.tournament_configuration configuration
    CROSS JOIN initial
    WHERE configuration.owner_id =
      '31000000-0000-4000-8000-000000000001'
      AND configuration.campaign_action ->> 'configurationVersion' =
        initial.configuration_version
      AND configuration.campaign_action ->> 'candidateSnapshotVersion' =
        'snapshot-11111111111111111111111111111111'
      AND configuration.campaign_action ->> 'kind' = 'configured'
  ) THEN
    RAISE EXCEPTION 'campaign acknowledgement was not exactly bound';
  END IF;
END
$bound$;

DO $stale_snapshot$
BEGIN
  BEGIN
    PERFORM dna.acknowledge_tournament_campaign_action(
      '31000000-0000-4000-8000-000000000001',
      'campaign-cup', 'bike-a',
      (SELECT configuration_version FROM initial),
      'snapshot-22222222222222222222222222222222',
      'Stale action', 'Stale evidence'
    );
    RAISE EXCEPTION 'stale campaign snapshot was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'stale campaign snapshot was accepted' THEN RAISE; END IF;
  END;
END
$stale_snapshot$;

CREATE TEMP TABLE changed AS
SELECT * FROM dna.upsert_complete_tournament_configuration(
  '31000000-0000-4000-8000-000000000001',
  'campaign-cup', 'Campaign Cup', 'Season 12',
  '2026-09-01T00:00:00Z', '2026-09-07T00:00:00Z',
  'bike-a', 'Bike A', 'bike', ARRAY[1200], 8, 0.01, 'USD',
  'paid qualification', ARRAY['Genesis'], ARRAY['Bike'], ARRAY['Fire'],
  ARRAY[1], '[]'::jsonb, '[]'::jsonb, 'none', '[]'::jsonb,
  5, 3, NULL, 'fastest_single_time', NULL, '{}'::jsonb, '{}'::jsonb,
  'separate', 'eligible', 'confirmed', 'Synthetic rule.',
  'Rules screenshot.', '{"source":"owner_entry"}'::jsonb,
  '{
    "kind":"review_only_free_text",
    "action":"Review candidates",
    "ownerAcknowledgedAt":null,
    "evidence":null
  }'::jsonb
);

DO $drift$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM changed CROSS JOIN initial
    WHERE changed.configuration_version <> initial.configuration_version
      AND changed.candidate_snapshot_version = 'snapshot-unbound'
  ) OR NOT EXISTS (
    SELECT 1 FROM dna.tournament_configuration
    WHERE owner_id = '31000000-0000-4000-8000-000000000001'
      AND campaign_action ->> 'kind' = 'review_only_free_text'
  ) THEN
    RAISE EXCEPTION 'rule drift did not retire the campaign acknowledgement';
  END IF;
END
$drift$;

SET LOCAL app.owner_id = '31000000-0000-4000-8000-000000000002';
DO $isolation$
BEGIN
  BEGIN
    PERFORM dna.acknowledge_tournament_campaign_action(
      '31000000-0000-4000-8000-000000000001',
      'campaign-cup', 'bike-a',
      (SELECT configuration_version FROM changed),
      'snapshot-11111111111111111111111111111111',
      'Cross-owner action', 'Cross-owner evidence'
    );
    RAISE EXCEPTION 'cross-owner campaign acknowledgement was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner campaign acknowledgement was accepted' THEN
      RAISE;
    END IF;
  END;
END
$isolation$;

ROLLBACK;
