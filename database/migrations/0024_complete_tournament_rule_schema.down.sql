BEGIN;

ALTER TABLE dna.tournament_configuration
  DROP COLUMN provenance,
  DROP COLUMN source_evidence,
  DROP COLUMN rule_notes,
  DROP COLUMN rule_evidence_status,
  DROP COLUMN qualifying_race_semantics,
  DROP COLUMN custom_scoring_configuration,
  DROP COLUMN points_table,
  DROP COLUMN top_finish_position,
  DROP COLUMN ranking_metric,
  DROP COLUMN qualification_percentage,
  DROP COLUMN qualification_count,
  DROP COLUMN minimum_race_count,
  DROP COLUMN leaderboard_groups,
  DROP COLUMN leaderboard_split_dimension,
  DROP COLUMN eligibility_groups,
  DROP COLUMN eligible_f_number_ranges,
  DROP COLUMN eligible_f_numbers,
  DROP COLUMN eligible_elements,
  DROP COLUMN eligible_classes,
  DROP COLUMN eligible_breeds,
  DROP COLUMN race_format,
  DROP COLUMN entry_fee_asset,
  DROP COLUMN entry_fee_amount,
  DROP COLUMN gate_count,
  DROP COLUMN qualification_ends_at,
  DROP COLUMN qualification_starts_at,
  DROP COLUMN season_label;

COMMIT;
