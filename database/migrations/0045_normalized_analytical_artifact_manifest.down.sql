BEGIN;

REVOKE ALL ON FUNCTION dna.rollback_normalized_analytical_artifact(
  uuid, uuid, timestamptz
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.bind_normalized_analytical_artifact(
  uuid, uuid, uuid, timestamptz
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.register_normalized_analytical_artifact(
  uuid, uuid, text, text, character, bigint, bigint, bigint, bigint,
  bigint, character, timestamptz, timestamptz, timestamptz
) FROM dna_app_runtime;
REVOKE ALL ON TABLE dna.normalized_analytical_artifact FROM dna_app_runtime;

DROP FUNCTION dna.rollback_normalized_analytical_artifact(
  uuid, uuid, timestamptz
);
DROP FUNCTION dna.bind_normalized_analytical_artifact(
  uuid, uuid, uuid, timestamptz
);
DROP FUNCTION dna.register_normalized_analytical_artifact(
  uuid, uuid, text, text, character, bigint, bigint, bigint, bigint,
  bigint, character, timestamptz, timestamptz, timestamptz
);
DROP TABLE dna.normalized_analytical_artifact;

COMMIT;
