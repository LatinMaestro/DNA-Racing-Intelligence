BEGIN;

CREATE SCHEMA dna;

REVOKE ALL ON SCHEMA dna FROM PUBLIC;

CREATE FUNCTION dna.current_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT NULLIF(current_setting('app.owner_id', true), '')::uuid
$function$;

CREATE TABLE dna.app_owner (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dna.asset_currency (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  code text NOT NULL,
  display_name text NOT NULL,
  asset_kind text NOT NULL CHECK (
    asset_kind IN ('fiat', 'crypto', 'game_token', 'bgc')
  ),
  atomic_scale smallint NOT NULL CHECK (atomic_scale BETWEEN 0 AND 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, code),
  CHECK ((asset_kind = 'bgc') = (upper(code) = 'BGC'))
);

CREATE TABLE dna.import_batch (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (
    source_type IN (
      'race_merge',
      'core_details',
      'current_vault',
      'current_arena',
      'manual_economic',
      'manual_pre_run_star_observation'
    )
  ),
  source_filename text NOT NULL,
  checksum_sha256 character(64) NOT NULL CHECK (
    checksum_sha256 ~ '^[a-f0-9]{64}$'
  ),
  raw_object_key text,
  detected_encoding text NOT NULL DEFAULT 'unknown' CHECK (
    detected_encoding IN ('utf_8', 'windows_1252', 'other', 'unknown')
  ),
  schema_version text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('uploaded', 'validating', 'quarantined', 'accepted', 'rolled_back')
  ),
  uploaded_at timestamptz NOT NULL,
  import_completed_at timestamptz,
  minimum_accepted_event_at timestamptz,
  maximum_accepted_event_at timestamptz,
  dataset_current_through_after_import timestamptz,
  source_rows bigint NOT NULL CHECK (source_rows >= 0),
  accepted_rows bigint NOT NULL CHECK (accepted_rows >= 0),
  rejected_rows bigint NOT NULL CHECK (rejected_rows >= 0),
  warning_rows bigint NOT NULL CHECK (warning_rows >= 0),
  rollback_reason text,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, source_type, checksum_sha256),
  CHECK (accepted_rows + rejected_rows = source_rows),
  CHECK (warning_rows <= source_rows),
  CHECK (
    (minimum_accepted_event_at IS NULL) =
    (maximum_accepted_event_at IS NULL)
  ),
  CHECK (
    minimum_accepted_event_at IS NULL OR
    minimum_accepted_event_at <= maximum_accepted_event_at
  ),
  CHECK (
    source_type <> 'race_merge' OR
    accepted_rows = 0 OR
    minimum_accepted_event_at IS NOT NULL
  ),
  CHECK (
    maximum_accepted_event_at IS NULL OR
    dataset_current_through_after_import IS NULL OR
    dataset_current_through_after_import >= maximum_accepted_event_at
  ),
  CHECK (
    import_completed_at IS NULL OR
    import_completed_at >= uploaded_at
  ),
  CHECK (
    status NOT IN ('accepted', 'rolled_back') OR
    import_completed_at IS NOT NULL
  ),
  CHECK (
    status <> 'rolled_back' OR
    (rolled_back_at IS NOT NULL AND rollback_reason IS NOT NULL)
  )
);

CREATE TABLE dna.import_warning (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  warning_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  source_row_number bigint CHECK (source_row_number IS NULL OR source_row_number > 0),
  occurrence_count bigint NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE dna.dataset_version (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('race_merge', 'core_details', 'current_vault', 'current_arena')
  ),
  version_number bigint NOT NULL CHECK (version_number > 0),
  import_batch_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  data_current_through timestamptz,
  aggregate_refreshed_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, source_type, version_number),
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT,
  CHECK (NOT is_active OR rolled_back_at IS NULL)
);

CREATE UNIQUE INDEX dataset_version_one_active
  ON dna.dataset_version(owner_id, source_type)
  WHERE is_active;

CREATE TABLE dna.core (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_core_id text NOT NULL,
  display_name text,
  core_class text CHECK (
    core_class IS NULL OR
    core_class IN ('Genesis', 'Morphed', 'Freak', 'X-Class')
  ),
  element text CHECK (
    element IS NULL OR element IN ('Metal', 'Fire', 'Earth', 'Water')
  ),
  f_number integer CHECK (f_number IS NULL OR f_number > 0),
  sex text CHECK (sex IS NULL OR sex IN ('male', 'female')),
  source_import_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, source_core_id),
  FOREIGN KEY (owner_id, source_import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE dna.core_import_provenance (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  core_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_row_number bigint CHECK (source_row_number IS NULL OR source_row_number > 0),
  raw_source_core_id text NOT NULL,
  raw_source_name text,
  is_selected_fact boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, core_id, import_batch_id),
  FOREIGN KEY (owner_id, core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE dna.core_parent (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  child_core_id uuid NOT NULL,
  parent_core_id uuid NOT NULL,
  parent_role text NOT NULL CHECK (
    parent_role IN ('parent_1', 'parent_2', 'unknown')
  ),
  source_import_batch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, child_core_id, parent_core_id),
  FOREIGN KEY (owner_id, child_core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, parent_core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, source_import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT,
  CHECK (child_core_id <> parent_core_id)
);

CREATE UNIQUE INDEX core_parent_one_known_role
  ON dna.core_parent(owner_id, child_core_id, parent_role)
  WHERE parent_role <> 'unknown';

CREATE TABLE dna.identity_review (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (
    source_type IN ('current_vault', 'current_arena', 'race_merge')
  ),
  import_batch_id uuid NOT NULL,
  raw_source_core_id text,
  raw_source_name text,
  proposed_core_id uuid,
  match_status text NOT NULL CHECK (
    match_status IN ('ambiguous', 'unmatched', 'confirmed', 'rejected')
  ),
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, proposed_core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE SET NULL,
  CHECK (
    match_status NOT IN ('confirmed', 'rejected') OR
    resolved_at IS NOT NULL
  )
);

CREATE TABLE dna.race_event (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_event_id text NOT NULL,
  event_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('bike', 'car', 'horse')),
  distance integer NOT NULL CHECK (distance > 0),
  gate_count smallint NOT NULL CHECK (gate_count > 0),
  gold_star_eligible boolean GENERATED ALWAYS AS (gate_count > 3) STORED,
  source_format_label text,
  source_race_class text,
  source_import_batch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, source_event_id),
  UNIQUE (owner_id, id, gate_count),
  FOREIGN KEY (owner_id, source_import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT
);

CREATE TABLE dna.race_entry (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  race_event_id uuid NOT NULL,
  source_core_id text NOT NULL,
  core_id uuid,
  gate_count smallint NOT NULL CHECK (gate_count > 0),
  gold_star_eligible boolean GENERATED ALWAYS AS (gate_count > 3) STORED,
  gold_star boolean,
  blue_star boolean,
  star_data_status text NOT NULL CHECK (
    star_data_status IN ('complete', 'partial', 'missing', 'invalid')
  ),
  elapsed_time_milliseconds bigint CHECK (
    elapsed_time_milliseconds IS NULL OR elapsed_time_milliseconds > 0
  ),
  speed_microunits bigint CHECK (
    speed_microunits IS NULL OR speed_microunits > 0
  ),
  finish_position smallint CHECK (
    finish_position IS NULL OR finish_position > 0
  ),
  economic_data_status text NOT NULL DEFAULT 'unvalidated' CHECK (
    economic_data_status IN ('absent', 'unvalidated', 'validated', 'invalid')
  ),
  source_import_batch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, race_event_id, source_core_id),
  FOREIGN KEY (owner_id, race_event_id, gate_count)
    REFERENCES dna.race_event(owner_id, id, gate_count) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, source_import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT
);

CREATE TABLE dna.race_entry_source (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  race_entry_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_row_number bigint CHECK (source_row_number IS NULL OR source_row_number > 0),
  source_row_checksum character(64) CHECK (
    source_row_checksum IS NULL OR source_row_checksum ~ '^[a-f0-9]{64}$'
  ),
  raw_gold_star text,
  raw_blue_star text,
  raw_entry_fee text,
  raw_payout text,
  is_selected_fact boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, race_entry_id, import_batch_id),
  UNIQUE (owner_id, import_batch_id, source_row_number),
  FOREIGN KEY (owner_id, race_entry_id)
    REFERENCES dna.race_entry(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE dna.event_star_validation (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  race_event_id uuid NOT NULL,
  gate_count smallint NOT NULL CHECK (gate_count > 0),
  gold_star_eligible boolean GENERATED ALWAYS AS (gate_count > 3) STORED,
  gold_assignment_count smallint NOT NULL CHECK (gold_assignment_count >= 0),
  blue_assignment_count smallint NOT NULL CHECK (blue_assignment_count >= 0),
  gold_source_core_id text,
  blue_source_core_id text,
  same_core_received_both boolean NOT NULL,
  validation_status text NOT NULL CHECK (
    validation_status IN ('valid', 'warning', 'invalid')
  ),
  warning_codes text[] NOT NULL DEFAULT '{}',
  refreshed_at timestamptz NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, race_event_id),
  FOREIGN KEY (owner_id, race_event_id, gate_count)
    REFERENCES dna.race_event(owner_id, id, gate_count) ON DELETE CASCADE,
  CHECK (
    (gold_assignment_count = 0 AND gold_source_core_id IS NULL) OR
    (gold_assignment_count > 0 AND gold_source_core_id IS NOT NULL)
  ),
  CHECK (
    (blue_assignment_count = 0 AND blue_source_core_id IS NULL) OR
    (blue_assignment_count > 0 AND blue_source_core_id IS NOT NULL)
  )
);

CREATE TABLE dna.manual_star_observation (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  reconciliation_key text NOT NULL,
  key_authority text NOT NULL CHECK (
    key_authority IN ('authoritative_event_id', 'candidate_only')
  ),
  authoritative_source_event_id text,
  event_starts_at timestamptz NOT NULL,
  mode text NOT NULL CHECK (mode IN ('bike', 'car', 'horse')),
  distance integer NOT NULL CHECK (distance > 0),
  gate_count smallint NOT NULL CHECK (gate_count > 0),
  gold_star_eligible boolean GENERATED ALWAYS AS (gate_count > 3) STORED,
  observed_gold_source_core_id text,
  observed_blue_source_core_id text,
  observed_at timestamptz NOT NULL,
  reconciliation_status text NOT NULL DEFAULT 'pending' CHECK (
    reconciliation_status IN (
      'pending',
      'reconciled',
      'mismatch',
      'review_required',
      'excluded'
    )
  ),
  warning_codes text[] NOT NULL DEFAULT '{}',
  reconciled_race_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, reconciliation_key),
  FOREIGN KEY (owner_id, reconciled_race_event_id)
    REFERENCES dna.race_event(owner_id, id) ON DELETE SET NULL,
  CHECK (
    (key_authority = 'authoritative_event_id') =
    (authoritative_source_event_id IS NOT NULL)
  ),
  CHECK (
    reconciliation_status NOT IN ('reconciled', 'mismatch') OR
    reconciled_race_event_id IS NOT NULL
  )
);

CREATE TABLE dna.manual_star_observation_entry (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  source_core_id text NOT NULL,
  is_owner_entry boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, observation_id, source_core_id),
  FOREIGN KEY (owner_id, observation_id)
    REFERENCES dna.manual_star_observation(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE dna.star_observation_reconciliation (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  race_event_id uuid NOT NULL,
  result text NOT NULL CHECK (
    result IN ('exact_match', 'mismatch', 'review_required', 'excluded')
  ),
  detail_code text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, observation_id, race_event_id),
  FOREIGN KEY (owner_id, observation_id)
    REFERENCES dna.manual_star_observation(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, race_event_id)
    REFERENCES dna.race_event(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE dna.vault_snapshot (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  captured_at timestamptz,
  imported_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, import_batch_id),
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX vault_snapshot_one_current
  ON dna.vault_snapshot(owner_id)
  WHERE is_current;

CREATE TABLE dna.vault_snapshot_core (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  vault_snapshot_id uuid NOT NULL,
  source_core_id text NOT NULL,
  core_id uuid,
  raw_source_name text,
  maiden_state text NOT NULL CHECK (
    maiden_state IN ('eligible', 'not_eligible', 'unknown', 'invalid')
  ),
  breeding_availability text NOT NULL DEFAULT 'available' CHECK (
    breeding_availability IN ('available', 'unavailable', 'unknown')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, vault_snapshot_id, source_core_id),
  FOREIGN KEY (owner_id, vault_snapshot_id)
    REFERENCES dna.vault_snapshot(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE SET NULL
);

CREATE TABLE dna.arena_snapshot (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  captured_at timestamptz,
  imported_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, import_batch_id),
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX arena_snapshot_one_current
  ON dna.arena_snapshot(owner_id)
  WHERE is_current;

CREATE TABLE dna.arena_listing (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  arena_snapshot_id uuid NOT NULL,
  source_listing_id text,
  source_core_id text NOT NULL,
  core_id uuid,
  expires_at timestamptz,
  nominated_fee_asset_id uuid,
  nominated_fee_atomic numeric(78, 0),
  active_in_snapshot boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, arena_snapshot_id, source_core_id),
  FOREIGN KEY (owner_id, arena_snapshot_id)
    REFERENCES dna.arena_snapshot(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id, nominated_fee_asset_id)
    REFERENCES dna.asset_currency(owner_id, id) ON DELETE RESTRICT,
  CHECK (
    (nominated_fee_asset_id IS NULL) =
    (nominated_fee_atomic IS NULL)
  ),
  CHECK (nominated_fee_atomic IS NULL OR nominated_fee_atomic >= 0)
);

CREATE TABLE dna.economic_transaction (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  natural_key text NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN (
      'race_derived',
      'manual',
      'authoritative_import',
      'reversal',
      'adjustment'
    )
  ),
  import_batch_id uuid,
  race_entry_id uuid,
  asset_currency_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  amount_atomic numeric(78, 0) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit', 'zero')),
  category text NOT NULL CHECK (
    category IN (
      'open_race_entry_fee',
      'open_race_payout',
      'tournament_qualification_entry_fee',
      'tournament_qualification_payout',
      'tournament_round_payout',
      'tournament_final_payout',
      'manual_tournament_prize',
      'race_refund_adjustment',
      'breeding_fee_earned',
      'dna_splice_fee',
      'external_arena_fee',
      'bgc_arena_fee',
      'core_purchase',
      'core_mint',
      'core_sale',
      'marketplace_fee',
      'burn_event',
      'bgc_burn_credit',
      'deposit',
      'withdrawal',
      'internal_transfer',
      'opening_balance',
      'reconciliation_adjustment',
      'unclassified'
    )
  ),
  subcategory text,
  operating_effect boolean NOT NULL,
  classification_status text NOT NULL CHECK (
    classification_status IN (
      'source_confirmed',
      'manual',
      'inferred',
      'review_required'
    )
  ),
  duplicate_status text NOT NULL DEFAULT 'clear' CHECK (
    duplicate_status IN ('clear', 'potential_duplicate', 'excluded')
  ),
  external_reference text,
  notes text,
  reverses_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, natural_key),
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, race_entry_id)
    REFERENCES dna.race_entry(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, asset_currency_id)
    REFERENCES dna.asset_currency(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, reverses_transaction_id)
    REFERENCES dna.economic_transaction(owner_id, id) ON DELETE RESTRICT,
  CHECK (
    (direction = 'credit' AND amount_atomic > 0) OR
    (direction = 'debit' AND amount_atomic < 0) OR
    (direction = 'zero' AND amount_atomic = 0)
  ),
  CHECK (
    category NOT IN (
      'deposit',
      'withdrawal',
      'internal_transfer',
      'opening_balance',
      'reconciliation_adjustment'
    ) OR NOT operating_effect
  ),
  CHECK (reverses_transaction_id IS NULL OR reverses_transaction_id <> id)
);

CREATE TABLE dna.transaction_allocation (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  economic_transaction_id uuid NOT NULL,
  core_id uuid,
  allocation_method text NOT NULL CHECK (
    allocation_method IN (
      'unallocated',
      'single_core',
      'equal_split',
      'manual_percentage',
      'manual_amount',
      'points_contribution'
    )
  ),
  allocated_amount_atomic numeric(78, 0),
  allocation_percentage numeric(9, 6) CHECK (
    allocation_percentage IS NULL OR
    allocation_percentage BETWEEN 0 AND 100
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, economic_transaction_id)
    REFERENCES dna.economic_transaction(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE SET NULL,
  CHECK (
    allocation_method <> 'single_core' OR core_id IS NOT NULL
  )
);

CREATE TABLE dna.reconciliation_issue (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  issue_type text NOT NULL CHECK (
    issue_type IN (
      'identity',
      'duplicate',
      'star_mismatch',
      'economic_classification',
      'missing_cost_basis',
      'source_conflict',
      'other'
    )
  ),
  entity_type text NOT NULL,
  entity_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'resolved', 'excluded')
  ),
  reason_code text NOT NULL,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  CHECK (status = 'open' OR resolved_at IS NOT NULL)
);

CREATE TABLE dna.aggregate_refresh_job (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  status text NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'rolled_back')
  ),
  started_at timestamptz,
  completed_at timestamptz,
  affected_record_count bigint CHECK (
    affected_record_count IS NULL OR affected_record_count >= 0
  ),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE CASCADE,
  CHECK (
    completed_at IS NULL OR
    (started_at IS NOT NULL AND completed_at >= started_at)
  )
);

CREATE INDEX import_batch_owner_status
  ON dna.import_batch(owner_id, status, uploaded_at DESC);
CREATE INDEX race_event_owner_mode_distance_time
  ON dna.race_event(owner_id, mode, distance, event_at DESC);
CREATE INDEX race_entry_owner_core
  ON dna.race_entry(owner_id, core_id, race_event_id);
CREATE INDEX race_entry_star_profile
  ON dna.race_entry(
    owner_id,
    core_id,
    gold_star_eligible,
    gold_star,
    blue_star
  );
CREATE INDEX manual_star_observation_status
  ON dna.manual_star_observation(owner_id, reconciliation_status, observed_at DESC);
CREATE INDEX economic_transaction_reporting
  ON dna.economic_transaction(
    owner_id,
    asset_currency_id,
    occurred_at DESC,
    category
  );
CREATE INDEX reconciliation_issue_queue
  ON dna.reconciliation_issue(owner_id, status, issue_type, created_at);

ALTER TABLE dna.app_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.app_owner FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.app_owner
  USING (id = dna.current_owner_id())
  WITH CHECK (id = dna.current_owner_id());

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'asset_currency',
    'import_batch',
    'import_warning',
    'dataset_version',
    'core',
    'core_import_provenance',
    'core_parent',
    'identity_review',
    'race_event',
    'race_entry',
    'race_entry_source',
    'event_star_validation',
    'manual_star_observation',
    'manual_star_observation_entry',
    'star_observation_reconciliation',
    'vault_snapshot',
    'vault_snapshot_core',
    'arena_snapshot',
    'arena_listing',
    'economic_transaction',
    'transaction_allocation',
    'reconciliation_issue',
    'aggregate_refresh_job'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY',
      table_name
    );
    EXECUTE format(
      'ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY owner_isolation ON dna.%I USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id())',
      table_name
    );
  END LOOP;
END
$policies$;

REVOKE ALL ON ALL TABLES IN SCHEMA dna FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dna FROM PUBLIC;

COMMIT;
