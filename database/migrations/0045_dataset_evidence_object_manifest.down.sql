BEGIN;

DROP FUNCTION IF EXISTS dna.register_dataset_evidence_object(
  uuid, uuid, text, text, integer, text, text, character,
  bigint, bigint, text, text, timestamptz
);
DROP TABLE IF EXISTS dna.dataset_evidence_object;

COMMIT;
