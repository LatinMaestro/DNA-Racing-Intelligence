DO $race_row_evidence_compaction_removal$
BEGIN
  IF to_regclass('dna.race_row_evidence_compaction_receipt') IS NOT NULL THEN
    RAISE EXCEPTION 'Race Merge row compaction receipt table was not removed';
  END IF;

  IF to_regprocedure(
    'dna.compact_race_row_evidence(uuid,uuid,timestamp with time zone)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Race Merge row compaction function was not removed';
  END IF;

  IF to_regprocedure('dna.suppress_race_merge_version_record()') IS NOT NULL THEN
    RAISE EXCEPTION 'Race Merge version-ledger suppression helper was not removed';
  END IF;

  IF to_regprocedure(
    'dna.accept_staged_race_dataset_pre_compact_replay(uuid,uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'pre-compact Race Merge acceptance helper was not removed';
  END IF;

  IF to_regprocedure(
    'dna.accept_staged_race_dataset(uuid,uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Race Merge acceptance function was not restored';
  END IF;
END
$race_row_evidence_compaction_removal$;
