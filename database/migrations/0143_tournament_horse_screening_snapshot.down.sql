BEGIN;
DROP FUNCTION dna.read_active_tournament_horse_screening_snapshot(uuid);
DROP FUNCTION dna.publish_tournament_horse_screening_snapshot(
  uuid,text,text,text,timestamptz);
DROP TABLE dna.tournament_horse_screening_snapshot_active;
DROP TABLE dna.tournament_horse_screening_snapshot;
COMMIT;
