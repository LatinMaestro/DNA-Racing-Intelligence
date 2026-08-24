BEGIN;

DO $irreversible_compaction_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dna.race_row_evidence_compaction_receipt
  ) THEN
    RAISE EXCEPTION
      'cannot reverse Race Merge row compaction after durable compaction receipts exist';
  END IF;
END
$irreversible_compaction_guard$;

REVOKE ALL ON FUNCTION dna.compact_race_row_evidence(
  uuid, uuid, timestamptz
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) FROM dna_app_runtime;
REVOKE ALL ON TABLE dna.race_row_evidence_compaction_receipt FROM dna_app_runtime;

DROP FUNCTION dna.compact_race_row_evidence(uuid, uuid, timestamptz);

DROP TRIGGER suppress_race_merge_version_record
  ON dna.dataset_version_record;
DROP FUNCTION dna.suppress_race_merge_version_record();

DROP FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
);
ALTER FUNCTION dna.accept_staged_race_dataset_pre_compact_replay(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) RENAME TO accept_staged_race_dataset;

GRANT EXECUTE ON FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) TO dna_app_runtime;

DROP TABLE dna.race_row_evidence_compaction_receipt;

COMMIT;
