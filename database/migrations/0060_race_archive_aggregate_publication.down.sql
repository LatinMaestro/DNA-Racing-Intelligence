BEGIN;

DROP FUNCTION IF EXISTS dna.publish_race_archive_aggregates(
  uuid, uuid, text, character, bigint, bigint, bigint, bigint, bigint,
  bigint, timestamptz
);
DROP FUNCTION IF EXISTS dna.stage_race_archive_aggregate_rows(
  uuid, uuid, text, text, integer, jsonb
);
DROP FUNCTION IF EXISTS dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
);

DROP TABLE IF EXISTS dna.race_archive_aggregate_publication_stage_row;
DROP TABLE IF EXISTS dna.race_archive_aggregate_publication_stage;
DROP TABLE IF EXISTS dna.race_archive_aggregate_publication_receipt;

COMMIT;