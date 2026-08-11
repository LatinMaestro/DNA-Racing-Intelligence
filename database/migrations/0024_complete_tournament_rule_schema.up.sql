BEGIN;

ALTER TABLE dna.tournament_configuration
  ADD COLUMN season_label text NOT NULL DEFAULT 'Unspecified',
  ADD COLUMN qualification_starts_at timestamptz,
  ADD COLUMN qualification_ends_at timestamptz,
  ADD COLUMN gate_count integer NOT NULL DEFAULT 4,
  ADD COLUMN entry_fee_amount numeric(38, 18) NOT NULL DEFAULT 0,
  ADD COLUMN entry_fee_asset text NOT NULL DEFAULT 'Unspecified',
  ADD COLUMN race_format text NOT NULL DEFAULT 'Unspecified',
  ADD COLUMN eligible_breeds text[] NOT NULL DEFAULT '{}',
  ADD COLUMN eligible_classes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN eligible_elements text[] NOT NULL DEFAULT '{}',
  ADD COLUMN eligible_f_numbers integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN eligible_f_number_ranges jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN eligibility_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN leaderboard_split_dimension text NOT NULL DEFAULT 'none',
  ADD COLUMN leaderboard_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN minimum_race_count integer NOT NULL DEFAULT 1,
  ADD COLUMN qualification_count integer DEFAULT 1,
  ADD COLUMN qualification_percentage numeric(7, 4),
  ADD COLUMN ranking_metric text NOT NULL DEFAULT 'fastest_single_time',
  ADD COLUMN top_finish_position integer,
  ADD COLUMN points_table jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN custom_scoring_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN qualifying_race_semantics text NOT NULL DEFAULT 'separate',
  ADD COLUMN rule_evidence_status text NOT NULL DEFAULT 'uncertain',
  ADD COLUMN rule_notes text NOT NULL DEFAULT '',
  ADD COLUMN source_evidence text NOT NULL DEFAULT '',
  ADD COLUMN provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT tournament_qualification_window_valid CHECK (
    qualification_starts_at IS NULL
    OR qualification_ends_at IS NULL
    OR qualification_starts_at <= qualification_ends_at
  ),
  ADD CONSTRAINT tournament_gate_count_valid CHECK (
    gate_count BETWEEN 1 AND 100
  ),
  ADD CONSTRAINT tournament_entry_fee_valid CHECK (
    entry_fee_amount >= 0
  ),
  ADD CONSTRAINT tournament_eligibility_arrays_valid CHECK (
    array_position(eligible_breeds, NULL) IS NULL
    AND array_position(eligible_classes, NULL) IS NULL
    AND array_position(eligible_elements, NULL) IS NULL
    AND array_position(eligible_f_numbers, NULL) IS NULL
    AND 0 < ALL (eligible_f_numbers)
  ),
  ADD CONSTRAINT tournament_eligibility_json_valid CHECK (
    jsonb_typeof(eligible_f_number_ranges) = 'array'
    AND jsonb_typeof(eligibility_groups) = 'array'
  ),
  ADD CONSTRAINT tournament_leaderboard_groups_valid CHECK (
    jsonb_typeof(leaderboard_groups) = 'array'
  ),
  ADD CONSTRAINT tournament_minimum_race_count_valid CHECK (
    minimum_race_count > 0
  ),
  ADD CONSTRAINT tournament_qualification_result_valid CHECK (
    ((qualification_count IS NULL) <> (qualification_percentage IS NULL))
    AND (qualification_count IS NULL OR qualification_count > 0)
    AND (
      qualification_percentage IS NULL
      OR qualification_percentage > 0
      AND qualification_percentage <= 100
    )
  ),
  ADD CONSTRAINT tournament_ranking_metric_valid CHECK (
    ranking_metric IN (
      'fastest_single_time',
      'median_time',
      'average_time',
      'points',
      'wins',
      'top_x_finishes',
      'best_finish',
      'custom'
    )
  ),
  ADD CONSTRAINT tournament_top_finish_position_valid CHECK (
    (
      ranking_metric = 'top_x_finishes'
      AND top_finish_position IS NOT NULL
      AND top_finish_position > 0
    )
    OR (
      ranking_metric <> 'top_x_finishes'
      AND top_finish_position IS NULL
    )
  ),
  ADD CONSTRAINT tournament_scoring_json_valid CHECK (
    jsonb_typeof(points_table) = 'object'
    AND jsonb_typeof(custom_scoring_configuration) = 'object'
  ),
  ADD CONSTRAINT tournament_race_semantics_valid CHECK (
    qualifying_race_semantics IN ('shared', 'separate')
  ),
  ADD CONSTRAINT tournament_rule_evidence_status_valid CHECK (
    rule_evidence_status IN ('confirmed', 'uncertain')
  ),
  ADD CONSTRAINT tournament_provenance_valid CHECK (
    jsonb_typeof(provenance) = 'object'
  );

COMMIT;
