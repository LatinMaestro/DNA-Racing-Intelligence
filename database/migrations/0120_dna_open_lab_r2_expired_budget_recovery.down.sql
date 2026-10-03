BEGIN;

REVOKE ALL ON FUNCTION
  dna.reconcile_expired_dna_open_lab_r2_budget_window(uuid)
FROM PUBLIC, dna_app_runtime;

DROP FUNCTION IF EXISTS
  dna.reconcile_expired_dna_open_lab_r2_budget_window(uuid);

COMMIT;
