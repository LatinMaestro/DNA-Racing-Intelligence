BEGIN;

DROP VIEW IF EXISTS dna.race_economic_usd_coverage;

DROP FUNCTION IF EXISTS dna.refresh_race_usd_valuations(uuid, timestamptz);
DROP FUNCTION IF EXISTS dna.materialize_race_economics(uuid, timestamptz);
DROP FUNCTION IF EXISTS dna.accept_daily_usd_rate(
  text, date, text, text, text, timestamptz, timestamptz, text
);

DELETE FROM dna.economic_transaction
WHERE
  source_type = 'race_derived'
  AND subcategory IN ('race_entry_fee', 'race_prize')
  AND notes = 'materialized by migration 0009';

UPDATE dna.race_entry
SET economic_data_status = 'unvalidated'
WHERE economic_data_status IN ('validated', 'invalid');

DROP TABLE IF EXISTS dna.economic_transaction_usd_valuation;
DROP TABLE IF EXISTS dna.asset_daily_usd_rate;

ALTER TABLE dna.race_event
  DROP COLUMN IF EXISTS race_tags_source_value,
  DROP COLUMN IF EXISTS payout_mechanism_source_value;

ALTER TABLE dna.normalized_race_staged_fact
  DROP COLUMN IF EXISTS race_tags_source_value,
  DROP COLUMN IF EXISTS payout_mechanism_source_value;

COMMIT;
