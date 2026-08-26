BEGIN;

REVOKE ALL ON FUNCTION dna.list_import_preview_race_evidence_manifest(
  uuid, uuid, integer
) FROM dna_app_runtime;
DROP FUNCTION dna.list_import_preview_race_evidence_manifest(
  uuid, uuid, integer
);

COMMIT;
