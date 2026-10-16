BEGIN;
DROP FUNCTION IF EXISTS dna.read_open_race_workspace_sessions(uuid,integer);
DROP TABLE IF EXISTS dna.open_race_workspace_session_snapshot;
COMMIT;
