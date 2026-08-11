BEGIN;
DROP FUNCTION IF EXISTS dna.list_tournament_configurations(uuid);
DROP TABLE IF EXISTS dna.tournament_configuration;
COMMIT;
