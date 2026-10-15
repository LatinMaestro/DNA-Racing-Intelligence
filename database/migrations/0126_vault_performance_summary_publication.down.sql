BEGIN;
DROP TRIGGER IF EXISTS invalidate_vault_performance_summary_on_import
  ON dna.import_batch;
DROP TRIGGER IF EXISTS invalidate_vault_performance_summary_on_reconciliation
  ON dna.reconciliation_issue;
DROP TRIGGER IF EXISTS invalidate_vault_performance_summary_on_asset
  ON dna.asset_currency;
DROP TRIGGER IF EXISTS invalidate_vault_performance_summary_on_transaction
  ON dna.economic_transaction;
DROP FUNCTION IF EXISTS dna.publish_vault_performance_summary_snapshot(uuid,text,timestamptz,text,text);
DROP FUNCTION IF EXISTS dna.read_vault_performance_source_identity(uuid);
DROP FUNCTION IF EXISTS dna.claim_vault_performance_source_identity(uuid,bigint,text);
DROP FUNCTION IF EXISTS dna.read_vault_performance_canonical_source(uuid);
DROP FUNCTION IF EXISTS dna.invalidate_vault_performance_summary_source();
DROP TABLE IF EXISTS dna.vault_performance_summary_source_state;
COMMIT;
