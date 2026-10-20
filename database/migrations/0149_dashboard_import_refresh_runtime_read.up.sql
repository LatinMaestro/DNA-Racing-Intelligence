BEGIN;

-- Dashboard freshness joins the latest aggregate refresh status to the
-- already owner-scoped import workspace. Forced RLS remains authoritative.
GRANT SELECT ON TABLE dna.aggregate_refresh_job TO dna_app_runtime;

COMMIT;
