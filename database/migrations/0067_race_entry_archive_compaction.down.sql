BEGIN;

DO $race_entry_archive_compaction_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dna.race_entry_archive_compaction_receipt
  ) THEN
    RAISE EXCEPTION
      'cannot reverse Race entry archive compaction after durable compaction receipts exist';
  END IF;
END
$race_entry_archive_compaction_guard$;

DROP FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
);

ALTER FUNCTION dna.publish_pro_league_aggregate_refresh_pre_entry_compact(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) RENAME TO publish_pro_league_aggregate_refresh;

REVOKE ALL ON FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) TO dna_app_runtime;

DROP FUNCTION dna.compact_published_race_entries(
  uuid, uuid, timestamptz
);
DROP TABLE dna.race_entry_archive_compaction_receipt;

COMMIT;
