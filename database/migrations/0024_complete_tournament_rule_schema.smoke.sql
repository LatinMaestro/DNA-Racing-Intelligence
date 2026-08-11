BEGIN;

SET LOCAL app.owner_id = '24000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '24000000-0000-4000-8000-000000000001',
  'synthetic_complete_tournament_owner'
);

SELECT *
FROM dna.upsert_tournament_configuration(
  '24000000-0000-4000-8000-000000000001',
  'complete-cup',
  'Complete Cup',
  'bike-element',
  'Bike element split',
  'bike',
  ARRAY[1200, 1400],
  'priority',
  'Top three finishes',
  'rules-v1',
  'snapshot-unbound',
  '2026-08-11T12:00:00Z'
);

DO $legacy_defaults$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.tournament_configuration configuration
    WHERE configuration.owner_id = '24000000-0000-4000-8000-000000000001'
      AND configuration.tournament_id = 'complete-cup'
      AND configuration.bracket_id = 'bike-element'
      AND configuration.gate_count = 4
      AND configuration.entry_fee_amount = 0
      AND configuration.minimum_race_count = 1
      AND configuration.qualification_count = 1
      AND configuration.qualification_percentage IS NULL
      AND configuration.ranking_metric = 'fastest_single_time'
      AND configuration.qualifying_race_semantics = 'separate'
      AND configuration.rule_evidence_status = 'uncertain'
  ) THEN
    RAISE EXCEPTION 'existing Tournament write path did not receive safe defaults';
  END IF;
END
$legacy_defaults$;

UPDATE dna.tournament_configuration
SET
  season_label = 'Season 12',
  qualification_starts_at = '2026-09-01T00:00:00Z',
  qualification_ends_at = '2026-09-07T23:59:59Z',
  gate_count = 8,
  entry_fee_amount = 0.010000000000000000,
  entry_fee_asset = 'USD',
  race_format = 'paid qualification',
  eligible_breeds = ARRAY['Genesis', 'Elite'],
  eligible_classes = ARRAY['Bike'],
  eligible_elements = ARRAY['Metal', 'Fire'],
  eligible_f_numbers = ARRAY[1, 2, 3],
  eligible_f_number_ranges = '[{"minimum":1,"maximum":3}]'::jsonb,
  eligibility_groups = '[{"id":"metal-fire","elements":["Metal","Fire"]}]'::jsonb,
  leaderboard_split_dimension = 'element_group',
  leaderboard_groups = '[{"id":"metal-fire","label":"Metal + Fire"}]'::jsonb,
  minimum_race_count = 5,
  qualification_count = NULL,
  qualification_percentage = 10,
  ranking_metric = 'top_x_finishes',
  top_finish_position = 3,
  points_table = '{"1":10,"2":6,"3":3}'::jsonb,
  custom_scoring_configuration = '{}'::jsonb,
  qualifying_race_semantics = 'shared',
  rule_evidence_status = 'confirmed',
  rule_notes = 'Synthetic confirmed rule variant.',
  source_evidence = 'Synthetic rules screenshot.',
  provenance = '{"source":"owner_entry","version":"rules-v1"}'::jsonb
WHERE owner_id = '24000000-0000-4000-8000-000000000001'
  AND tournament_id = 'complete-cup'
  AND bracket_id = 'bike-element';

DO $complete_rule_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.tournament_configuration configuration
    WHERE configuration.owner_id = '24000000-0000-4000-8000-000000000001'
      AND configuration.season_label = 'Season 12'
      AND configuration.qualification_starts_at = '2026-09-01T00:00:00Z'
      AND configuration.qualification_ends_at = '2026-09-07T23:59:59Z'
      AND configuration.gate_count = 8
      AND configuration.entry_fee_amount = 0.010000000000000000
      AND configuration.entry_fee_asset = 'USD'
      AND configuration.eligible_elements = ARRAY['Metal', 'Fire']
      AND configuration.eligible_f_numbers = ARRAY[1, 2, 3]
      AND configuration.minimum_race_count = 5
      AND configuration.qualification_count IS NULL
      AND configuration.qualification_percentage = 10
      AND configuration.ranking_metric = 'top_x_finishes'
      AND configuration.top_finish_position = 3
      AND configuration.qualifying_race_semantics = 'shared'
      AND configuration.rule_evidence_status = 'confirmed'
      AND configuration.provenance ->> 'version' = 'rules-v1'
  ) THEN
    RAISE EXCEPTION 'complete Tournament rule variant was not persisted';
  END IF;
END
$complete_rule_assertions$;

DO $boundary_assertions$
BEGIN
  BEGIN
    UPDATE dna.tournament_configuration
    SET qualification_starts_at = '2026-09-08T00:00:00Z',
      qualification_ends_at = '2026-09-07T00:00:00Z'
    WHERE owner_id = '24000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'reversed qualification window was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE dna.tournament_configuration
    SET qualification_count = 2, qualification_percentage = 10
    WHERE owner_id = '24000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'ambiguous qualification result was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE dna.tournament_configuration
    SET ranking_metric = 'top_x_finishes', top_finish_position = NULL
    WHERE owner_id = '24000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'top-X metric without X was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE dna.tournament_configuration
    SET eligibility_groups = '{}'::jsonb
    WHERE owner_id = '24000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'invalid eligibility group shape was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$boundary_assertions$;

ROLLBACK;
