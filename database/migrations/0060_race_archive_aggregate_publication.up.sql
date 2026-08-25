BEGIN;

CREATE TABLE dna.race_archive_aggregate_publication_stage (
  owner_id uuid NOT NULL,
  refresh_id uuid NOT NULL,
  target_dataset_version_id uuid NOT NULL,
  race_dataset_version_id uuid NOT NULL,
  worker_id text NOT NULL CHECK (
    worker_id = btrim(worker_id)
    AND worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  source_version_set_sha256 character(64) NOT NULL CHECK (
    source_version_set_sha256 ~ '^[a-f0-9]{64}$'
  ),
  refreshed_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, refresh_id),
  FOREIGN KEY (owner_id, refresh_id)
    REFERENCES dna.aggregate_refresh_job(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, target_dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, race_dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE dna.race_archive_aggregate_publication_stage_row (
  owner_id uuid NOT NULL,
  refresh_id uuid NOT NULL,
  family text NOT NULL CHECK (family IN (
    'core_performance',
    'discovery_benchmark',
    'payout_format',
    'core_star_profile'
  )),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 4999999),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (owner_id, refresh_id, family, ordinal),
  FOREIGN KEY (owner_id, refresh_id)
    REFERENCES dna.race_archive_aggregate_publication_stage(owner_id, refresh_id)
    ON DELETE CASCADE
);

CREATE TABLE dna.race_archive_aggregate_publication_receipt (
  owner_id uuid NOT NULL,
  refresh_id uuid NOT NULL,
  target_dataset_version_id uuid NOT NULL,
  race_dataset_version_id uuid NOT NULL,
  source_version_set_sha256 character(64) NOT NULL CHECK (
    source_version_set_sha256 ~ '^[a-f0-9]{64}$'
  ),
  payload_sha256 character(64) NOT NULL CHECK (
    payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  aggregate_family_count smallint NOT NULL DEFAULT 4 CHECK (
    aggregate_family_count = 4
  ),
  core_performance_profile_count bigint NOT NULL CHECK (
    core_performance_profile_count BETWEEN 0 AND 500000
  ),
  validated_event_count bigint NOT NULL CHECK (
    validated_event_count BETWEEN 0 AND 1000000
  ),
  core_star_profile_count bigint NOT NULL CHECK (
    core_star_profile_count BETWEEN 0 AND 500000
  ),
  discovery_benchmark_count bigint NOT NULL CHECK (
    discovery_benchmark_count BETWEEN 0 AND 100000
  ),
  accepted_format_entry_count bigint NOT NULL CHECK (
    accepted_format_entry_count BETWEEN 0 AND 5000000
  ),
  payout_format_profile_count bigint NOT NULL CHECK (
    payout_format_profile_count BETWEEN 0 AND 500000
  ),
  materialized_row_count bigint NOT NULL CHECK (materialized_row_count >= 0),
  refreshed_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, refresh_id),
  FOREIGN KEY (owner_id, refresh_id)
    REFERENCES dna.aggregate_refresh_job(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, target_dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, race_dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE CASCADE,
  CHECK (published_at >= refreshed_at),
  CHECK (accepted_format_entry_count >= payout_format_profile_count),
  CHECK (
    materialized_row_count = core_performance_profile_count
      + validated_event_count
      + core_star_profile_count
      + discovery_benchmark_count
      + payout_format_profile_count
  )
);

ALTER TABLE dna.race_archive_aggregate_publication_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_archive_aggregate_publication_stage FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_archive_aggregate_publication_stage
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.race_archive_aggregate_publication_stage_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_archive_aggregate_publication_stage_row FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_archive_aggregate_publication_stage_row
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.race_archive_aggregate_publication_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_archive_aggregate_publication_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_archive_aggregate_publication_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.begin_race_archive_aggregate_publication(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_race_dataset_version_id uuid,
  p_worker_id text,
  p_source_version_set_sha256 character(64),
  p_refreshed_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_processing dna.aggregate_refresh_processing%ROWTYPE;
  v_target_version dna.dataset_version%ROWTYPE;
  v_race_version dna.dataset_version%ROWTYPE;
  v_receipt dna.race_archive_aggregate_publication_receipt%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive aggregate publication denied';
  END IF;
  IF p_worker_id IS NULL
     OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$' THEN
    RAISE EXCEPTION 'Race archive aggregate worker ID is invalid';
  END IF;
  IF p_source_version_set_sha256 IS NULL
     OR p_source_version_set_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race archive aggregate source-version checksum is invalid';
  END IF;
  IF p_refreshed_at IS NULL THEN
    RAISE EXCEPTION 'Race archive aggregate refresh timestamp is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_owner_id::text || ':race-archive-aggregate:' || p_refresh_id::text,
      0
    )
  );

  SELECT receipt.* INTO v_receipt
  FROM dna.race_archive_aggregate_publication_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.refresh_id = p_refresh_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_receipt.race_dataset_version_id <> p_race_dataset_version_id
       OR v_receipt.source_version_set_sha256 <> p_source_version_set_sha256 THEN
      RAISE EXCEPTION 'Race archive aggregate publication replay conflict';
    END IF;
    RETURN 'published';
  END IF;

  SELECT processing.* INTO v_processing
  FROM dna.aggregate_refresh_processing processing
  WHERE processing.owner_id = p_owner_id
    AND processing.refresh_id = p_refresh_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_processing.state <> 'processing'
     OR v_processing.worker_id <> p_worker_id
     OR v_processing.source_version_set_sha256 <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'Race archive aggregate refresh claim is unavailable';
  END IF;

  SELECT version.* INTO v_target_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = v_processing.dataset_version_id
    AND version.rolled_back_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Race archive aggregate target dataset version is unavailable';
  END IF;

  SELECT version.* INTO v_race_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_race_dataset_version_id
    AND version.source_type = 'race_merge'
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active owner-scoped Race Merge archive version is unavailable';
  END IF;
  IF p_refreshed_at < GREATEST(
    v_target_version.activated_at,
    v_race_version.activated_at
  ) THEN
    RAISE EXCEPTION 'Race archive aggregate refresh cannot predate active source versions';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'Race archive aggregate source versions were superseded';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.dataset_version version
    JOIN dna.import_batch batch
      ON batch.owner_id = version.owner_id
      AND batch.id = version.import_batch_id
      AND batch.source_type = 'race_merge'
      AND batch.status = 'accepted'
    LEFT JOIN dna.dataset_version_evidence_receipt evidence
      ON evidence.owner_id = version.owner_id
      AND evidence.dataset_version_id = version.id
      AND evidence.import_batch_id = version.import_batch_id
      AND evidence.source_type = 'race_merge'
    LEFT JOIN dna.race_archive_core_locator_receipt locator
      ON locator.owner_id = version.owner_id
      AND locator.dataset_version_id = version.id
      AND locator.import_batch_id = version.import_batch_id
    WHERE version.owner_id = p_owner_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
      AND version.version_number <= v_race_version.version_number
      AND (
        evidence.dataset_version_id IS NULL
        OR evidence.evidence_kind <> 'staged_rows'
        OR evidence.evidence_row_count <> batch.source_rows
        OR evidence.evidence_partition_count NOT BETWEEN 1 AND 10000
        OR locator.dataset_version_id IS NULL
        OR locator.ready_row_count <> batch.accepted_rows
      )
  ) THEN
    RAISE EXCEPTION 'complete sealed Race archive aggregate evidence is unavailable';
  END IF;

  DELETE FROM dna.race_archive_aggregate_publication_stage
  WHERE owner_id = p_owner_id AND refresh_id = p_refresh_id;

  INSERT INTO dna.race_archive_aggregate_publication_stage (
    owner_id,
    refresh_id,
    target_dataset_version_id,
    race_dataset_version_id,
    worker_id,
    source_version_set_sha256,
    refreshed_at
  ) VALUES (
    p_owner_id,
    p_refresh_id,
    v_processing.dataset_version_id,
    p_race_dataset_version_id,
    p_worker_id,
    p_source_version_set_sha256,
    p_refreshed_at
  );

  RETURN 'staging';
END
$function$;

CREATE FUNCTION dna.stage_race_archive_aggregate_rows(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_worker_id text,
  p_family text,
  p_start_ordinal integer,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive aggregate staging denied';
  END IF;
  IF p_family NOT IN (
    'core_performance',
    'discovery_benchmark',
    'payout_format',
    'core_star_profile'
  ) THEN
    RAISE EXCEPTION 'Race archive aggregate family is invalid';
  END IF;
  IF p_start_ordinal IS NULL OR p_start_ordinal < 0 THEN
    RAISE EXCEPTION 'Race archive aggregate start ordinal is invalid';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Race archive aggregate staged rows must be a JSON array';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count NOT BETWEEN 1 AND 2000
     OR p_start_ordinal::bigint + v_count - 1 > 4999999 THEN
    RAISE EXCEPTION 'Race archive aggregate staged row chunk is outside its bound';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.race_archive_aggregate_publication_stage stage
    WHERE stage.owner_id = p_owner_id
      AND stage.refresh_id = p_refresh_id
      AND stage.worker_id = p_worker_id
  ) THEN
    RAISE EXCEPTION 'Race archive aggregate publication stage is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) row_value
    WHERE jsonb_typeof(row_value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Race archive aggregate staged payload rows must be objects';
  END IF;

  INSERT INTO dna.race_archive_aggregate_publication_stage_row (
    owner_id,
    refresh_id,
    family,
    ordinal,
    payload
  )
  SELECT
    p_owner_id,
    p_refresh_id,
    p_family,
    p_start_ordinal + row_value.ordinality::integer - 1,
    row_value.value
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS row_value(value, ordinality);

  RETURN v_count;
END
$function$;

CREATE FUNCTION dna.publish_race_archive_aggregates(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_worker_id text,
  p_payload_sha256 character(64),
  p_validated_event_count bigint,
  p_accepted_format_entry_count bigint,
  p_core_performance_profile_count bigint,
  p_discovery_benchmark_count bigint,
  p_payout_format_profile_count bigint,
  p_core_star_profile_count bigint,
  p_completed_at timestamptz
)
RETURNS TABLE (
  status text,
  materialized_row_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_stage dna.race_archive_aggregate_publication_stage%ROWTYPE;
  v_receipt dna.race_archive_aggregate_publication_receipt%ROWTYPE;
  v_performance_count bigint;
  v_discovery_count bigint;
  v_payout_count bigint;
  v_star_count bigint;
  v_performance_min integer;
  v_performance_max integer;
  v_discovery_min integer;
  v_discovery_max integer;
  v_payout_min integer;
  v_payout_max integer;
  v_star_min integer;
  v_star_max integer;
  v_inserted bigint;
  v_materialized bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive aggregate publication denied';
  END IF;
  IF p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race archive aggregate payload checksum is invalid';
  END IF;
  IF p_completed_at IS NULL THEN
    RAISE EXCEPTION 'Race archive aggregate publication timestamp is required';
  END IF;
  IF p_validated_event_count NOT BETWEEN 0 AND 1000000
     OR p_accepted_format_entry_count NOT BETWEEN 0 AND 5000000
     OR p_core_performance_profile_count NOT BETWEEN 0 AND 500000
     OR p_discovery_benchmark_count NOT BETWEEN 0 AND 100000
     OR p_payout_format_profile_count NOT BETWEEN 0 AND 500000
     OR p_core_star_profile_count NOT BETWEEN 0 AND 500000
     OR p_accepted_format_entry_count < p_payout_format_profile_count THEN
    RAISE EXCEPTION 'Race archive aggregate publication counts are outside their bounds';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_owner_id::text || ':race-archive-aggregate:' || p_refresh_id::text,
      0
    )
  );

  SELECT receipt.* INTO v_receipt
  FROM dna.race_archive_aggregate_publication_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.refresh_id = p_refresh_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_receipt.payload_sha256 <> p_payload_sha256
       OR v_receipt.validated_event_count <> p_validated_event_count
       OR v_receipt.accepted_format_entry_count <> p_accepted_format_entry_count
       OR v_receipt.core_performance_profile_count <> p_core_performance_profile_count
       OR v_receipt.discovery_benchmark_count <> p_discovery_benchmark_count
       OR v_receipt.payout_format_profile_count <> p_payout_format_profile_count
       OR v_receipt.core_star_profile_count <> p_core_star_profile_count THEN
      RAISE EXCEPTION 'Race archive aggregate publication replay conflict';
    END IF;
    RETURN QUERY SELECT 'existing'::text, v_receipt.materialized_row_count;
    RETURN;
  END IF;

  SELECT stage.* INTO v_stage
  FROM dna.race_archive_aggregate_publication_stage stage
  WHERE stage.owner_id = p_owner_id
    AND stage.refresh_id = p_refresh_id
    AND stage.worker_id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Race archive aggregate publication stage is unavailable';
  END IF;
  IF p_completed_at < v_stage.refreshed_at THEN
    RAISE EXCEPTION 'Race archive aggregate publication cannot predate refresh';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> v_stage.source_version_set_sha256 THEN
    RAISE EXCEPTION 'Race archive aggregate source versions were superseded';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.refresh_id = p_refresh_id
      AND processing.dataset_version_id = v_stage.target_dataset_version_id
      AND processing.worker_id = p_worker_id
      AND processing.state = 'processing'
      AND processing.source_version_set_sha256 = v_stage.source_version_set_sha256
  ) THEN
    RAISE EXCEPTION 'Race archive aggregate refresh claim is unavailable';
  END IF;

  SELECT
    count(*) FILTER (WHERE family = 'core_performance'),
    count(*) FILTER (WHERE family = 'discovery_benchmark'),
    count(*) FILTER (WHERE family = 'payout_format'),
    count(*) FILTER (WHERE family = 'core_star_profile'),
    min(ordinal) FILTER (WHERE family = 'core_performance'),
    max(ordinal) FILTER (WHERE family = 'core_performance'),
    min(ordinal) FILTER (WHERE family = 'discovery_benchmark'),
    max(ordinal) FILTER (WHERE family = 'discovery_benchmark'),
    min(ordinal) FILTER (WHERE family = 'payout_format'),
    max(ordinal) FILTER (WHERE family = 'payout_format'),
    min(ordinal) FILTER (WHERE family = 'core_star_profile'),
    max(ordinal) FILTER (WHERE family = 'core_star_profile')
  INTO
    v_performance_count,
    v_discovery_count,
    v_payout_count,
    v_star_count,
    v_performance_min,
    v_performance_max,
    v_discovery_min,
    v_discovery_max,
    v_payout_min,
    v_payout_max,
    v_star_min,
    v_star_max
  FROM dna.race_archive_aggregate_publication_stage_row
  WHERE owner_id = p_owner_id AND refresh_id = p_refresh_id;

  IF v_performance_count <> p_core_performance_profile_count
     OR v_discovery_count <> p_discovery_benchmark_count
     OR v_payout_count <> p_payout_format_profile_count
     OR v_star_count <> p_core_star_profile_count THEN
    RAISE EXCEPTION 'Race archive aggregate staged row counts do not match publication receipt';
  END IF;
  IF (v_performance_count > 0 AND (
        v_performance_min <> 0 OR v_performance_max <> v_performance_count - 1
      ))
     OR (v_discovery_count > 0 AND (
        v_discovery_min <> 0 OR v_discovery_max <> v_discovery_count - 1
      ))
     OR (v_payout_count > 0 AND (
        v_payout_min <> 0 OR v_payout_max <> v_payout_count - 1
      ))
     OR (v_star_count > 0 AND (
        v_star_min <> 0 OR v_star_max <> v_star_count - 1
      )) THEN
    RAISE EXCEPTION 'Race archive aggregate staged ordinals are incomplete';
  END IF;

  DELETE FROM dna.core_performance_profile WHERE owner_id = p_owner_id;
  INSERT INTO dna.core_performance_profile (
    owner_id, source_core_id, mode, distance, data_current_through,
    race_count, best_milliseconds, median_milliseconds, mean_milliseconds,
    trimmed_mean_milliseconds, standard_deviation_milliseconds,
    interquartile_range_milliseconds, best_metres_per_second,
    median_metres_per_second, refreshed_at
  )
  SELECT
    p_owner_id, payload.source_core_id, payload.mode, payload.distance,
    payload.data_current_through, payload.race_count, payload.best_milliseconds,
    payload.median_milliseconds, payload.mean_milliseconds,
    payload.trimmed_mean_milliseconds, payload.standard_deviation_milliseconds,
    payload.interquartile_range_milliseconds, payload.best_metres_per_second,
    payload.median_metres_per_second, v_stage.refreshed_at
  FROM dna.race_archive_aggregate_publication_stage_row staged
  CROSS JOIN LATERAL jsonb_to_record(staged.payload) AS payload(
    source_core_id text, mode text, distance integer,
    data_current_through timestamptz, race_count bigint,
    best_milliseconds numeric, median_milliseconds numeric,
    mean_milliseconds numeric, trimmed_mean_milliseconds numeric,
    standard_deviation_milliseconds numeric,
    interquartile_range_milliseconds numeric,
    best_metres_per_second numeric, median_metres_per_second numeric
  )
  WHERE staged.owner_id = p_owner_id
    AND staged.refresh_id = p_refresh_id
    AND staged.family = 'core_performance'
    AND payload.source_core_id = btrim(payload.source_core_id)
    AND payload.data_current_through <= v_stage.refreshed_at
  ORDER BY staged.ordinal;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> p_core_performance_profile_count THEN
    RAISE EXCEPTION 'Race archive Core Performance payload is invalid';
  END IF;

  DELETE FROM dna.discovery_exact_distance_benchmark WHERE owner_id = p_owner_id;
  INSERT INTO dna.discovery_exact_distance_benchmark (
    owner_id, mode, distance, data_current_through, race_entry_count,
    winning_entry_count, top_three_entry_count, winning_p25_milliseconds,
    winning_median_milliseconds, winning_p75_milliseconds,
    top_three_p25_milliseconds, top_three_median_milliseconds,
    top_three_p75_milliseconds, refreshed_at
  )
  SELECT
    p_owner_id, payload.mode, payload.distance_metres,
    payload.data_current_through, payload.race_entry_count,
    payload.winning_entry_count, payload.top_three_entry_count,
    payload.winning_p25_milliseconds, payload.winning_median_milliseconds,
    payload.winning_p75_milliseconds, payload.top_three_p25_milliseconds,
    payload.top_three_median_milliseconds, payload.top_three_p75_milliseconds,
    v_stage.refreshed_at
  FROM dna.race_archive_aggregate_publication_stage_row staged
  CROSS JOIN LATERAL jsonb_to_record(staged.payload) AS payload(
    mode text, distance_metres integer, data_current_through timestamptz,
    race_entry_count bigint, winning_entry_count bigint,
    top_three_entry_count bigint, winning_p25_milliseconds numeric,
    winning_median_milliseconds numeric, winning_p75_milliseconds numeric,
    top_three_p25_milliseconds numeric, top_three_median_milliseconds numeric,
    top_three_p75_milliseconds numeric
  )
  WHERE staged.owner_id = p_owner_id
    AND staged.refresh_id = p_refresh_id
    AND staged.family = 'discovery_benchmark'
    AND payload.data_current_through <= v_stage.refreshed_at
  ORDER BY staged.ordinal;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> p_discovery_benchmark_count THEN
    RAISE EXCEPTION 'Race archive Discovery benchmark payload is invalid';
  END IF;

  DELETE FROM dna.core_payout_format_profile WHERE owner_id = p_owner_id;
  INSERT INTO dna.core_payout_format_profile (
    owner_id, source_core_id, mode, payout_format_key, payout_format_label,
    data_current_through, first_event_at, race_count, win_count,
    top_three_count, exact_distance_count, timed_race_count, refreshed_at
  )
  SELECT
    p_owner_id, payload.source_core_id, payload.mode, payload.payout_format_key,
    payload.payout_format_label, payload.data_current_through,
    payload.first_event_at, payload.race_count, payload.win_count,
    payload.top_three_count, payload.exact_distance_count,
    payload.timed_race_count, v_stage.refreshed_at
  FROM dna.race_archive_aggregate_publication_stage_row staged
  CROSS JOIN LATERAL jsonb_to_record(staged.payload) AS payload(
    source_core_id text, mode text, payout_format_key text,
    payout_format_label text, data_current_through timestamptz,
    first_event_at timestamptz, race_count bigint, win_count bigint,
    top_three_count bigint, exact_distance_count integer, timed_race_count bigint
  )
  WHERE staged.owner_id = p_owner_id
    AND staged.refresh_id = p_refresh_id
    AND staged.family = 'payout_format'
    AND payload.source_core_id = btrim(payload.source_core_id)
    AND payload.first_event_at <= payload.data_current_through
    AND payload.data_current_through <= v_stage.refreshed_at
  ORDER BY staged.ordinal;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> p_payout_format_profile_count THEN
    RAISE EXCEPTION 'Race archive payout-format payload is invalid';
  END IF;

  DELETE FROM dna.core_star_profile WHERE owner_id = p_owner_id;
  INSERT INTO dna.core_star_profile (
    owner_id, source_core_id, mode, distance, data_current_through, race_count,
    complete_star_data_race_count, partial_star_data_race_count,
    missing_star_data_race_count, invalid_star_data_race_count,
    gold_eligible_race_count, gold_assignment_opportunity_count,
    gold_received_count, gold_negative_opportunity_count,
    gold_eligible_no_assignment_count, gold_ineligible_assignment_count,
    gold_excluded_anomaly_count, blue_assignment_opportunity_count,
    blue_received_count, blue_negative_opportunity_count,
    blue_no_assignment_count, blue_excluded_anomaly_count,
    same_core_received_both_count, refreshed_at
  )
  SELECT
    p_owner_id, payload.source_core_id, payload.mode, payload.distance,
    payload.data_current_through, payload.race_count,
    payload.complete_star_data_race_count, payload.partial_star_data_race_count,
    payload.missing_star_data_race_count, payload.invalid_star_data_race_count,
    payload.gold_eligible_race_count, payload.gold_assignment_opportunity_count,
    payload.gold_received_count, payload.gold_negative_opportunity_count,
    payload.gold_eligible_no_assignment_count,
    payload.gold_ineligible_assignment_count, payload.gold_excluded_anomaly_count,
    payload.blue_assignment_opportunity_count, payload.blue_received_count,
    payload.blue_negative_opportunity_count, payload.blue_no_assignment_count,
    payload.blue_excluded_anomaly_count, payload.same_core_received_both_count,
    v_stage.refreshed_at
  FROM dna.race_archive_aggregate_publication_stage_row staged
  CROSS JOIN LATERAL jsonb_to_record(staged.payload) AS payload(
    source_core_id text, mode text, distance integer,
    data_current_through timestamptz, race_count bigint,
    complete_star_data_race_count bigint, partial_star_data_race_count bigint,
    missing_star_data_race_count bigint, invalid_star_data_race_count bigint,
    gold_eligible_race_count bigint, gold_assignment_opportunity_count bigint,
    gold_received_count bigint, gold_negative_opportunity_count bigint,
    gold_eligible_no_assignment_count bigint,
    gold_ineligible_assignment_count bigint, gold_excluded_anomaly_count bigint,
    blue_assignment_opportunity_count bigint, blue_received_count bigint,
    blue_negative_opportunity_count bigint, blue_no_assignment_count bigint,
    blue_excluded_anomaly_count bigint, same_core_received_both_count bigint
  )
  WHERE staged.owner_id = p_owner_id
    AND staged.refresh_id = p_refresh_id
    AND staged.family = 'core_star_profile'
    AND payload.source_core_id = btrim(payload.source_core_id)
    AND payload.data_current_through <= v_stage.refreshed_at
  ORDER BY staged.ordinal;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> p_core_star_profile_count THEN
    RAISE EXCEPTION 'Race archive Core star-profile payload is invalid';
  END IF;

  v_materialized := p_core_performance_profile_count
    + p_validated_event_count
    + p_core_star_profile_count
    + p_discovery_benchmark_count
    + p_payout_format_profile_count;

  INSERT INTO dna.race_archive_aggregate_publication_receipt (
    owner_id, refresh_id, target_dataset_version_id,
    race_dataset_version_id, source_version_set_sha256, payload_sha256,
    core_performance_profile_count, validated_event_count,
    core_star_profile_count, discovery_benchmark_count,
    accepted_format_entry_count, payout_format_profile_count,
    materialized_row_count, refreshed_at, published_at
  ) VALUES (
    p_owner_id, p_refresh_id, v_stage.target_dataset_version_id,
    v_stage.race_dataset_version_id, v_stage.source_version_set_sha256,
    p_payload_sha256, p_core_performance_profile_count,
    p_validated_event_count, p_core_star_profile_count,
    p_discovery_benchmark_count, p_accepted_format_entry_count,
    p_payout_format_profile_count, v_materialized, v_stage.refreshed_at,
    p_completed_at
  );

  DELETE FROM dna.race_archive_aggregate_publication_stage
  WHERE owner_id = p_owner_id AND refresh_id = p_refresh_id;

  RETURN QUERY SELECT 'published'::text, v_materialized;
END
$function$;

COMMENT ON TABLE dna.race_archive_aggregate_publication_receipt IS
  'Owner-scoped receipt for atomic Race archive-derived aggregate publication. Event star validation remains reconstructable from immutable Race archive evidence; only its verified count is retained here so the 746k-event validation cache need not become permanent historical storage.';

REVOKE ALL ON TABLE dna.race_archive_aggregate_publication_stage FROM PUBLIC;
REVOKE ALL ON TABLE dna.race_archive_aggregate_publication_stage_row FROM PUBLIC;
REVOKE ALL ON TABLE dna.race_archive_aggregate_publication_receipt FROM PUBLIC;
REVOKE ALL ON TABLE dna.race_archive_aggregate_publication_stage FROM dna_app_runtime;
REVOKE ALL ON TABLE dna.race_archive_aggregate_publication_stage_row FROM dna_app_runtime;
REVOKE ALL ON TABLE dna.race_archive_aggregate_publication_receipt FROM dna_app_runtime;

REVOKE ALL ON FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.stage_race_archive_aggregate_rows(
  uuid, uuid, text, text, integer, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_race_archive_aggregates(
  uuid, uuid, text, character, bigint, bigint, bigint, bigint, bigint,
  bigint, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.begin_race_archive_aggregate_publication(
  uuid, uuid, uuid, text, character, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.stage_race_archive_aggregate_rows(
  uuid, uuid, text, text, integer, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_race_archive_aggregates(
  uuid, uuid, text, character, bigint, bigint, bigint, bigint, bigint,
  bigint, timestamptz
) TO dna_app_runtime;

COMMIT;