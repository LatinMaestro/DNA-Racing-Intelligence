BEGIN;

SET LOCAL app.owner_id = '21000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES
  ('21000000-0000-4000-8000-000000000001', 'synthetic_tournament_owner'),
  ('21000000-0000-4000-8000-000000000002', 'synthetic_tournament_other');

INSERT INTO dna.tournament_configuration (
  owner_id, tournament_id, tournament_label, bracket_id, split_label,
  mode, eligible_distances_metres, discovery_relevance,
  qualification_metric_label, configuration_version,
  candidate_snapshot_version, updated_at
)
VALUES (
  '21000000-0000-4000-8000-000000000001',
  'tour-1', 'Synthetic Cup', 'split-a', 'Bike A',
  'bike', ARRAY[1200, 1400], 'priority',
  'Qualification points', 'config-1', 'snapshot-1',
  '2026-08-11T09:00:00Z'
);

DO $tournament_assertions$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.list_tournament_configurations(
      '21000000-0000-4000-8000-000000000001'
    )
  ) <> 1 THEN
    RAISE EXCEPTION 'Tournament configuration read did not return one row';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.list_tournament_configurations(
      '21000000-0000-4000-8000-000000000001'
    ) configuration
    WHERE configuration.mode = 'bike'
      AND configuration.eligible_distances_metres = ARRAY[1200, 1400]
      AND configuration.discovery_relevance = 'priority'
      AND configuration.qualification_metric_label = 'Qualification points'
  ) THEN
    RAISE EXCEPTION 'Tournament configuration values are wrong';
  END IF;
END
$tournament_assertions$;

CREATE ROLE dna_ci_tournament NOLOGIN;
GRANT USAGE ON SCHEMA dna TO dna_ci_tournament;
GRANT EXECUTE ON FUNCTION dna.current_owner_id() TO dna_ci_tournament;
GRANT EXECUTE ON FUNCTION dna.list_tournament_configurations(uuid)
  TO dna_ci_tournament;

SET LOCAL ROLE dna_ci_tournament;
SET LOCAL app.owner_id = '21000000-0000-4000-8000-000000000002';

DO $isolation_assertions$
BEGIN
  BEGIN
    PERFORM *
    FROM dna.list_tournament_configurations(
      '21000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cross-owner Tournament configuration read was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-owner Tournament configuration read was allowed' THEN
      RAISE;
    END IF;
  END;
END
$isolation_assertions$;

RESET ROLE;
ROLLBACK;
