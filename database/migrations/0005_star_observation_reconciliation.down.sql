BEGIN;

DROP FUNCTION IF EXISTS dna.reconcile_manual_star_observations(timestamptz);
DROP INDEX IF EXISTS dna.race_event_reconcile_candidate;
DROP INDEX IF EXISTS dna.manual_star_observation_reconcile_queue;

COMMIT;
