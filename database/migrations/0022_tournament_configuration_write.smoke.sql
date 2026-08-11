BEGIN;

SET LOCAL app.owner_id = '22000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('22000000-0000-4000-8000-000000000001', 'synthetic_tournament_write_owner'),
  ('22000000-0000-4000-8000-000000000002', 'synthetic_tournament_write_other');

SELECT *
FROM dna.upsert_tournament_configuration(
  '22000000-0000-4000-8000-000000000001',
  'tour-write',
  'Write Cup',
  'bike-a',
  'Bike A',
  'bike',
  ARRAY[1200, 1400],
  'priority',
  'Qualification points',
  'config-1',
  'snapshot-1',
  '2026-08-11T10:10:00Z'
);

DO $write_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.tournament_configuration configuration
    WHERE configuration.owner_id = '22000000-0000-4000-8000-000000000001'
      AND configuration.tournament_id = 'tour-write'
      AND configuration.bracket_id = 'bike-a'
      AND configuration.mode = 'bike'
      AND configuration.eligible_distances_metres = ARRAY[1200, 1400]
      AND configuration.discovery_relevance = 'priority'
      AND configuration.updated_at = '2026-08-11T10:10:00Z'
  ) THEN
    RAISE EXCEPTION 'Tournament configuration insert failed';
  END IF;
END
$write_assertions$;

SELECT *
FROM dna.upsert_tournament_configuration(
  '22000000-0000-4000-8000-000000000001',
  'tour-write',
  'Write Cup Updated',
  'bike-a',
  'Bike A Updated',
  'bike',
  ARRAY[1600],
  'eligible',
  'Updated points',
  'config-2',
  'snapshot-2',
  '2026-08-11T10:20:00Z'
);

DO $update_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.tournament_configuration configuration
    WHERE configuration.owner_id = '22000000-0000-4000-8000-000000000001'
      AND configuration.tournament_id = 'tour-write'
      AND configuration.bracket_id = 'bike-a'
      AND configuration.tournament_label = 'Write Cup Updated'
      AND configuration.split_label = 'Bike A Updated'
      AND configuration.eligible_distances_metres = ARRAY[1600]
      AND configuration.discovery_relevance = 'eligible'
      AND configuration.configuration_version = 'config-2'
      AND configuration.candidate_snapshot_version = 'snapshot-2'
      AND configuration.updated_at = '2026-08-11T10:20:00Z'
  ) THEN
    RAISE EXCEPTION 'Tournament configuration update failed';
  END IF;
END
$update_assertions$;

CREATE ROLE dna_ci_tournament_write NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_tournament_write;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_tournament_write;
GRANT EXECUTE ON FUNCTION dna.upsert_tournament_configuration(
  uuid, text, text, text, text, text, integer[], text, text, text, text, timestamptz
) TO dna_ci_tournament_write;

SET LOCAL ROLE dna_ci_tournament_write;
SET LOCAL app.owner_id = '22000000-0000-4000-8000-000000000002';

DO $isolation_assertions$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.upsert_tournament_configuration(
      '22000000-0000-4000-8000-000000000001',
      'forbidden',
      'Forbidden',
      'bike-a',
      'Bike A',
      'bike',
      ARRAY[1200],
      'eligible',
      'Points',
      'config-x',
      'snapshot-x',
      '2026-08-11T10:30:00Z'
    );
    RAISE EXCEPTION 'cross-owner Tournament configuration write was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Tournament configuration write was allowed' THEN
      RAISE;
    END IF;
  END;
END
$isolation_assertions$;

RESET ROLE;
ROLLBACK;
