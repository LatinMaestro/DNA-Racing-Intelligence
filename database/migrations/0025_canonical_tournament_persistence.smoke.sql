BEGIN;

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  (
    '25000000-0000-4000-8000-000000000001',
    'synthetic_canonical_tournament_owner'
  ),
  (
    '25000000-0000-4000-8000-000000000002',
    'synthetic_other_tournament_owner'
  );

SET LOCAL app.owner_id = '25000000-0000-4000-8000-000000000001';

CREATE TEMP TABLE initial_result AS
SELECT *
FROM dna.upsert_complete_tournament_configuration(
  '25000000-0000-4000-8000-000000000001',
  'canonical-cup',
  'Canonical Cup',
  'Season 12',
  '2026-09-01T00:00:00Z',
  '2026-09-07T23:59:59Z',
  'bike-element',
  'Bike element split',
  'bike',
  ARRAY[1200, 1400],
  8,
  0.01,
  'USD',
  'paid qualification',
  ARRAY['Genesis', 'Elite'],
  ARRAY['Bike'],
  ARRAY['Fire', 'Metal'],
  ARRAY[1, 2, 3],
  '[{"minimum":1,"maximum":3}]'::jsonb,
  '[{
    "id":"fire-metal",
    "label":"Fire + Metal",
    "breeds":[],
    "classes":["Bike"],
    "elements":["Fire","Metal"],
    "fNumbers":[1,2,3],
    "fNumberRanges":[]
  }]'::jsonb,
  'element_group',
  '[{"id":"fire-metal","label":"Fire + Metal"}]'::jsonb,
  5,
  NULL,
  10,
  'top_x_finishes',
  3,
  '{"1":"10","2":"6","3":"3"}'::jsonb,
  '{}'::jsonb,
  'shared',
  'priority',
  'confirmed',
  'Synthetic confirmed rule variant.',
  'Synthetic rules screenshot.',
  '{"source":"owner_entry","version":"rules-v1"}'::jsonb,
  '{
    "kind":"configured",
    "action":"Review candidates",
    "ownerAcknowledgedAt":"2026-08-12T00:00:00.000Z",
    "evidence":"Synthetic owner acknowledgement."
  }'::jsonb
);

DO $initial_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM initial_result result
    WHERE result.configuration_version LIKE 'cfg-%'
      AND length(result.configuration_version) = 36
      AND result.candidate_snapshot_version = 'snapshot-unbound'
  ) THEN
    RAISE EXCEPTION 'server-bound Tournament versions were not returned';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.tournament_configuration configuration
    WHERE configuration.owner_id =
        '25000000-0000-4000-8000-000000000001'
      AND configuration.tournament_id = 'canonical-cup'
      AND configuration.bracket_id = 'bike-element'
      AND configuration.season_label = 'Season 12'
      AND configuration.gate_count = 8
      AND configuration.entry_fee_amount = 0.01
      AND configuration.qualification_count IS NULL
      AND configuration.qualification_percentage = 10
      AND configuration.ranking_metric = 'top_x_finishes'
      AND configuration.top_finish_position = 3
      AND configuration.campaign_action ->> 'kind' = 'configured'
  ) THEN
    RAISE EXCEPTION 'complete canonical Tournament rules were not stored';
  END IF;
END
$initial_assertions$;

UPDATE dna.tournament_configuration
SET candidate_snapshot_version = 'snapshot-v1'
WHERE owner_id = '25000000-0000-4000-8000-000000000001'
  AND tournament_id = 'canonical-cup'
  AND bracket_id = 'bike-element';

CREATE TEMP TABLE replay_result AS
SELECT *
FROM dna.upsert_complete_tournament_configuration(
  '25000000-0000-4000-8000-000000000001',
  'canonical-cup',
  'Canonical Cup',
  'Season 12',
  '2026-09-01T00:00:00Z',
  '2026-09-07T23:59:59Z',
  'bike-element',
  'Bike element split',
  'bike',
  ARRAY[1200, 1400],
  8,
  0.01,
  'USD',
  'paid qualification',
  ARRAY['Genesis', 'Elite'],
  ARRAY['Bike'],
  ARRAY['Fire', 'Metal'],
  ARRAY[1, 2, 3],
  '[{"minimum":1,"maximum":3}]'::jsonb,
  '[{
    "id":"fire-metal",
    "label":"Fire + Metal",
    "breeds":[],
    "classes":["Bike"],
    "elements":["Fire","Metal"],
    "fNumbers":[1,2,3],
    "fNumberRanges":[]
  }]'::jsonb,
  'element_group',
  '[{"id":"fire-metal","label":"Fire + Metal"}]'::jsonb,
  5,
  NULL,
  10,
  'top_x_finishes',
  3,
  '{"1":"10","2":"6","3":"3"}'::jsonb,
  '{}'::jsonb,
  'shared',
  'priority',
  'confirmed',
  'Synthetic confirmed rule variant.',
  'Synthetic rules screenshot.',
  '{"source":"owner_entry","version":"rules-v1"}'::jsonb,
  '{
    "kind":"configured",
    "action":"Review candidates",
    "ownerAcknowledgedAt":"2026-08-12T00:00:00.000Z",
    "evidence":"Synthetic owner acknowledgement."
  }'::jsonb
);

DO $replay_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM replay_result replay
    CROSS JOIN initial_result initial
    WHERE replay.configuration_version = initial.configuration_version
      AND replay.candidate_snapshot_version = 'snapshot-v1'
      AND replay.updated_at = initial.updated_at
  ) THEN
    RAISE EXCEPTION 'exact rule replay was not idempotent';
  END IF;
END
$replay_assertions$;

CREATE TEMP TABLE changed_result AS
SELECT *
FROM dna.upsert_complete_tournament_configuration(
  '25000000-0000-4000-8000-000000000001',
  'canonical-cup',
  'Canonical Cup',
  'Season 12',
  '2026-09-01T00:00:00Z',
  '2026-09-07T23:59:59Z',
  'bike-element',
  'Bike element split',
  'bike',
  ARRAY[1200, 1400],
  4,
  0.01,
  'USD',
  'paid qualification',
  ARRAY['Genesis', 'Elite'],
  ARRAY['Bike'],
  ARRAY['Fire', 'Metal'],
  ARRAY[1, 2, 3],
  '[{"minimum":1,"maximum":3}]'::jsonb,
  '[{
    "id":"fire-metal",
    "label":"Fire + Metal",
    "breeds":[],
    "classes":["Bike"],
    "elements":["Fire","Metal"],
    "fNumbers":[1,2,3],
    "fNumberRanges":[]
  }]'::jsonb,
  'element_group',
  '[{"id":"fire-metal","label":"Fire + Metal"}]'::jsonb,
  5,
  NULL,
  10,
  'top_x_finishes',
  3,
  '{"1":"10","2":"6","3":"3"}'::jsonb,
  '{}'::jsonb,
  'shared',
  'priority',
  'confirmed',
  'Synthetic confirmed rule variant.',
  'Synthetic rules screenshot.',
  '{"source":"owner_entry","version":"rules-v1"}'::jsonb,
  '{
    "kind":"configured",
    "action":"Review candidates",
    "ownerAcknowledgedAt":"2026-08-12T00:00:00.000Z",
    "evidence":"Synthetic owner acknowledgement."
  }'::jsonb
);

DO $change_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM changed_result changed
    CROSS JOIN initial_result initial
    WHERE changed.configuration_version <> initial.configuration_version
      AND changed.candidate_snapshot_version = 'snapshot-unbound'
  ) THEN
    RAISE EXCEPTION 'rule drift did not invalidate candidate evidence';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.list_complete_tournament_configurations(
      '25000000-0000-4000-8000-000000000001'
    ) configuration
    WHERE configuration.tournament_id = 'canonical-cup'
      AND configuration.gate_count = 4
      AND configuration.candidate_snapshot_version = 'snapshot-unbound'
  ) THEN
    RAISE EXCEPTION 'complete Tournament read contract is incomplete';
  END IF;
END
$change_assertions$;

DO $campaign_action_boundary$
BEGIN
  BEGIN
    UPDATE dna.tournament_configuration
    SET campaign_action = '{
      "kind":"configured",
      "action":"Review candidates"
    }'::jsonb
    WHERE owner_id = '25000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'unacknowledged configured action was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$campaign_action_boundary$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '25000000-0000-4000-8000-000000000002';

DO $owner_isolation$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM *
    FROM dna.list_complete_tournament_configurations(
      '25000000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM =
      'owner-scoped complete Tournament configuration read denied';
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION 'cross-owner complete Tournament read was not denied';
  END IF;
END
$owner_isolation$;

ROLLBACK;
