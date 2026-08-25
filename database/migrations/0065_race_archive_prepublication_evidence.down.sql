BEGIN;

REVOKE ALL ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
) FROM dna_app_runtime;
REVOKE ALL ON TABLE dna.race_archive_prepublication_evidence_receipt
  FROM dna_app_runtime;

DROP FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
);
DROP FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
);

ALTER FUNCTION dna.list_race_archive_refresh_versions_pre_0065(
  uuid, uuid, uuid, character, integer
) RENAME TO list_race_archive_aggregate_refresh_versions;

ALTER FUNCTION dna.seal_dataset_version_evidence_pre_0065(
  uuid, uuid, timestamptz
) RENAME TO seal_dataset_version_evidence;

DROP FUNCTION dna.prepare_race_archive_prepublication_evidence(
  uuid, uuid, uuid, character, uuid, timestamptz
);
DROP FUNCTION dna.race_archive_prepublication_evidence_summary(
  uuid, uuid
);
DROP TABLE dna.race_archive_prepublication_evidence_receipt;

GRANT EXECUTE ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) IS
  'Returns the exact ordered sealed Race Merge version plan for one claimed archive-backed aggregate refresh from immutable staged-row evidence. Core archive locator receipts are intentionally not a plan prerequisite because the hosted archive traversal rebuilds and verifies them before aggregate publication. The historical-version bound is independent of the per-upload file-count limit.';

COMMIT;
