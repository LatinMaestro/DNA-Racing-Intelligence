BEGIN;

REVOKE SELECT ON TABLE dna.aggregate_refresh_job FROM dna_app_runtime;

COMMIT;
