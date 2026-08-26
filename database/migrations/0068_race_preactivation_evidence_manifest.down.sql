BEGIN;

DROP FUNCTION IF EXISTS dna.list_race_preactivation_evidence_manifest(
  uuid, uuid, integer
);

COMMIT;
