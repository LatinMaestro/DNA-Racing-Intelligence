BEGIN;

CREATE TEMP TABLE dna_0009_race_transaction_ids
ON COMMIT DROP
AS
SELECT DISTINCT economic_transaction_id
FROM dna.race_economic_contribution;

DROP FUNCTION IF EXISTS dna.rollback_active_dataset(
  text,
  text,
  timestamptz
);
ALTER FUNCTION dna.rollback_active_dataset_pre_economics(
  text,
  text,
  timestamptz
) RENAME TO rollback_active_dataset;

DROP FUNCTION IF EXISTS dna.refresh_race_usd_valuations(timestamptz);
DROP FUNCTION IF EXISTS dna.record_daily_usd_rate(
  text,
  date,
  numeric,
  text,
  text,
  timestamptz,
  timestamptz,
  text
);
DROP FUNCTION IF EXISTS dna.materialize_owned_race_economics(
  uuid,
  timestamptz
);
DROP FUNCTION IF EXISTS dna.race_economic_natural_key(
  text,
  text,
  text
);
DROP FUNCTION IF EXISTS dna.exact_decimal_to_atomic(numeric, smallint);

DROP VIEW IF EXISTS dna.race_economic_usd_coverage;
DROP VIEW IF EXISTS dna.current_race_economic_usd;
DROP TABLE IF EXISTS dna.economic_transaction_usd_valuation;
DROP TABLE IF EXISTS dna.race_economic_contribution;
DROP TABLE IF EXISTS dna.daily_usd_rate;

DELETE FROM dna.economic_transaction transaction
USING dna_0009_race_transaction_ids generated
WHERE transaction.id = generated.economic_transaction_id;

UPDATE dna.race_entry
SET economic_data_status = 'unvalidated'
WHERE economic_data_status IN ('validated', 'invalid');

ALTER TABLE dna.race_entry_source
  DROP COLUMN IF EXISTS raw_race_tags;

ALTER TABLE dna.race_event
  DROP COLUMN IF EXISTS payout_mechanism_source_value,
  DROP COLUMN IF EXISTS race_tags_source_value;

UPDATE dna.normalized_race_staged_fact
SET economic_data_status = 'unvalidated';

ALTER TABLE dna.normalized_race_staged_fact
  DROP CONSTRAINT
    IF EXISTS normalized_race_staged_fact_economics_ready_check,
  DROP CONSTRAINT
    IF EXISTS normalized_race_staged_fact_economic_data_status_check,
  DROP COLUMN IF EXISTS race_asset,
  DROP COLUMN IF EXISTS entry_fee_amount,
  DROP COLUMN IF EXISTS gross_payout_amount,
  DROP COLUMN IF EXISTS payout_mechanism_source_value,
  DROP COLUMN IF EXISTS race_tags_source_value,
  ADD CONSTRAINT normalized_race_staged_fact_economic_data_status_check
    CHECK (economic_data_status = 'unvalidated');

REVOKE ALL ON FUNCTION dna.rollback_active_dataset(
  text,
  text,
  timestamptz
) FROM PUBLIC;

COMMIT;
