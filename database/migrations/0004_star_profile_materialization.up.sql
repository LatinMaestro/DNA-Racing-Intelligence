BEGIN;

ALTER TABLE dna.event_star_validation
  ADD COLUMN entry_count bigint,
  ADD COLUMN gold_source_core_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN blue_source_core_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN gold_data_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN blue_data_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN gold_assignment_opportunity boolean NOT NULL DEFAULT false,
  ADD COLUMN blue_assignment_opportunity boolean NOT NULL DEFAULT false;

-- This table is a rebuildable derived cache. Clearing legacy rows avoids
-- carrying ambiguous single-ID semantics into the multi-assignment contract.
DELETE FROM dna.event_star_validation;

ALTER TABLE dna.event_star_validation
  ALTER COLUMN entry_count SET NOT NULL,
  ADD CONSTRAINT event_star_validation_entry_count_check CHECK (entry_count > 0);

DO $drop_legacy_assignment_checks$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE
      conrelid = 'dna.event_star_validation'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) LIKE '%gold_assignment_count = 0%gold_source_core_id IS NULL%'
        OR pg_get_constraintdef(oid) LIKE '%blue_assignment_count = 0%blue_source_core_id IS NULL%'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE dna.event_star_validation DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END
$drop_legacy_assignment_checks$;

ALTER TABLE dna.event_star_validation
  ADD CONSTRAINT event_star_validation_gold_unique_check CHECK (
    (gold_assignment_count = 1 AND gold_source_core_id IS NOT NULL)
    OR (gold_assignment_count <> 1 AND gold_source_core_id IS NULL)
  ),
  ADD CONSTRAINT event_star_validation_blue_unique_check CHECK (
    (blue_assignment_count = 1 AND blue_source_core_id IS NOT NULL)
    OR (blue_assignment_count <> 1 AND blue_source_core_id IS NULL)
  ),
  ADD CONSTRAINT event_star_validation_gold_array_check CHECK (
    cardinality(gold_source_core_ids) = gold_assignment_count
  ),
  ADD CONSTRAINT event_star_validation_blue_array_check CHECK (
    cardinality(blue_source_core_ids) = blue_assignment_count
  ),
  ADD CONSTRAINT event_star_validation_gold_opportunity_check CHECK (
    gold_assignment_opportunity = (
      gold_star_eligible
      AND gold_assignment_count = 1
      AND gold_data_complete
    )
  ),
  ADD CONSTRAINT event_star_validation_blue_opportunity_check CHECK (
    blue_assignment_opportunity = (
      blue_assignment_count = 1
      AND blue_data_complete
    )
  );

CREATE TABLE dna.core_star_profile (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_core_id text NOT NULL CHECK (NULLIF(btrim(source_core_id), '') IS NOT NULL),
  mode text NOT NULL CHECK (mode IN ('bike', 'car', 'horse')),
  distance integer NOT NULL CHECK (distance > 0),
  data_current_through timestamptz NOT NULL,
  race_count bigint NOT NULL CHECK (race_count > 0),
  complete_star_data_race_count bigint NOT NULL CHECK (complete_star_data_race_count >= 0),
  partial_star_data_race_count bigint NOT NULL CHECK (partial_star_data_race_count >= 0),
  missing_star_data_race_count bigint NOT NULL CHECK (missing_star_data_race_count >= 0),
  invalid_star_data_race_count bigint NOT NULL CHECK (invalid_star_data_race_count >= 0),
  gold_eligible_race_count bigint NOT NULL CHECK (gold_eligible_race_count >= 0),
  gold_assignment_opportunity_count bigint NOT NULL CHECK (gold_assignment_opportunity_count >= 0),
  gold_received_count bigint NOT NULL CHECK (gold_received_count >= 0),
  gold_negative_opportunity_count bigint NOT NULL CHECK (gold_negative_opportunity_count >= 0),
  gold_eligible_no_assignment_count bigint NOT NULL CHECK (gold_eligible_no_assignment_count >= 0),
  gold_ineligible_assignment_count bigint NOT NULL CHECK (gold_ineligible_assignment_count >= 0),
  gold_excluded_anomaly_count bigint NOT NULL CHECK (gold_excluded_anomaly_count >= 0),
  blue_assignment_opportunity_count bigint NOT NULL CHECK (blue_assignment_opportunity_count >= 0),
  blue_received_count bigint NOT NULL CHECK (blue_received_count >= 0),
  blue_negative_opportunity_count bigint NOT NULL CHECK (blue_negative_opportunity_count >= 0),
  blue_no_assignment_count bigint NOT NULL CHECK (blue_no_assignment_count >= 0),
  blue_excluded_anomaly_count bigint NOT NULL CHECK (blue_excluded_anomaly_count >= 0),
  same_core_received_both_count bigint NOT NULL CHECK (same_core_received_both_count >= 0),
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, source_core_id, mode, distance),
  CHECK (
    complete_star_data_race_count
    + partial_star_data_race_count
    + missing_star_data_race_count
    + invalid_star_data_race_count = race_count
  ),
  CHECK (
    gold_received_count + gold_negative_opportunity_count
    = gold_assignment_opportunity_count
  ),
  CHECK (
    blue_received_count + blue_negative_opportunity_count
    = blue_assignment_opportunity_count
  )
);

CREATE INDEX core_star_profile_lookup
  ON dna.core_star_profile(owner_id, mode, distance, source_core_id);
CREATE INDEX race_event_active_star_refresh
  ON dna.race_event(owner_id, event_at, id)
  WHERE active_in_dataset;
CREATE INDEX race_entry_active_star_refresh
  ON dna.race_entry(owner_id, race_event_id, source_core_id)
  WHERE active_in_dataset;

ALTER TABLE dna.core_star_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.core_star_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.core_star_profile
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.refresh_star_profiles(
  p_dataset_version_id uuid,
  p_refreshed_at timestamptz
)
RETURNS TABLE (
  validated_event_count bigint,
  refreshed_profile_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_version dna.dataset_version%ROWTYPE;
  v_event_count bigint;
  v_profile_count bigint;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for star-profile refresh';
  END IF;

  SELECT *
  INTO v_version
  FROM dna.dataset_version
  WHERE
    owner_id = v_owner_id
    AND id = p_dataset_version_id
    AND source_type = 'race_merge'
    AND is_active
    AND rolled_back_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active owner-scoped Race Merge version does not exist';
  END IF;

  IF p_refreshed_at < v_version.activated_at THEN
    RAISE EXCEPTION 'aggregate refresh cannot predate dataset activation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':star-profile-refresh', 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_job
    WHERE owner_id = v_owner_id AND dataset_version_id = v_version.id
  ) THEN
    RAISE EXCEPTION 'aggregate refresh job does not exist for dataset version';
  END IF;

  UPDATE dna.aggregate_refresh_job
  SET
    status = 'running',
    started_at = COALESCE(started_at, p_refreshed_at),
    completed_at = NULL,
    affected_record_count = NULL,
    failure_code = NULL
  WHERE owner_id = v_owner_id AND dataset_version_id = v_version.id;

  DROP TABLE IF EXISTS pg_temp.star_event_refresh;
  CREATE TEMP TABLE star_event_refresh ON COMMIT DROP AS
  SELECT
    event.id AS race_event_id,
    event.gate_count,
    event.gold_star_eligible,
    count(*)::bigint AS entry_count,
    (count(*) FILTER (WHERE entry.gold_star IS TRUE))::smallint AS gold_assignment_count,
    (count(*) FILTER (WHERE entry.blue_star IS TRUE))::smallint AS blue_assignment_count,
    COALESCE(
      array_agg(entry.source_core_id ORDER BY entry.source_core_id)
        FILTER (WHERE entry.gold_star IS TRUE),
      '{}'::text[]
    ) AS gold_source_core_ids,
    COALESCE(
      array_agg(entry.source_core_id ORDER BY entry.source_core_id)
        FILTER (WHERE entry.blue_star IS TRUE),
      '{}'::text[]
    ) AS blue_source_core_ids,
    bool_and(entry.gold_star IS NOT NULL) AS gold_data_complete,
    bool_and(entry.blue_star IS NOT NULL) AS blue_data_complete,
    bool_or(entry.star_data_status = 'invalid') AS has_invalid_data,
    bool_or(entry.star_data_status IN ('partial', 'missing')) AS has_incomplete_data
  FROM dna.race_event event
  JOIN dna.race_entry entry
    ON entry.owner_id = event.owner_id
    AND entry.race_event_id = event.id
    AND entry.active_in_dataset
  WHERE event.owner_id = v_owner_id AND event.active_in_dataset
  GROUP BY event.id, event.gate_count, event.gold_star_eligible;

  DELETE FROM dna.event_star_validation WHERE owner_id = v_owner_id;

  INSERT INTO dna.event_star_validation (
    id,
    owner_id,
    race_event_id,
    gate_count,
    gold_assignment_count,
    blue_assignment_count,
    gold_source_core_id,
    blue_source_core_id,
    same_core_received_both,
    validation_status,
    warning_codes,
    refreshed_at,
    entry_count,
    gold_source_core_ids,
    blue_source_core_ids,
    gold_data_complete,
    blue_data_complete,
    gold_assignment_opportunity,
    blue_assignment_opportunity
  )
  SELECT
    md5(v_owner_id::text || ':event_star_validation:' || refresh.race_event_id::text)::uuid,
    v_owner_id,
    refresh.race_event_id,
    refresh.gate_count,
    refresh.gold_assignment_count,
    refresh.blue_assignment_count,
    CASE WHEN refresh.gold_assignment_count = 1 THEN refresh.gold_source_core_ids[1] END,
    CASE WHEN refresh.blue_assignment_count = 1 THEN refresh.blue_source_core_ids[1] END,
    refresh.gold_assignment_count = 1
      AND refresh.blue_assignment_count = 1
      AND refresh.gold_source_core_ids[1] = refresh.blue_source_core_ids[1],
    CASE
      WHEN refresh.gold_assignment_count > 1
        OR refresh.blue_assignment_count > 1
        OR refresh.has_invalid_data THEN 'invalid'
      WHEN (NOT refresh.gold_star_eligible AND refresh.gold_assignment_count > 0)
        OR refresh.has_incomplete_data THEN 'warning'
      ELSE 'valid'
    END,
    array_remove(ARRAY[
      CASE WHEN NOT refresh.gold_star_eligible AND refresh.gold_assignment_count > 0
        THEN 'GOLD_INELIGIBLE_ASSIGNMENT' END,
      CASE WHEN refresh.gold_assignment_count > 1
        THEN 'MULTIPLE_GOLD_ASSIGNMENTS' END,
      CASE WHEN refresh.blue_assignment_count > 1
        THEN 'MULTIPLE_BLUE_ASSIGNMENTS' END,
      CASE WHEN refresh.has_invalid_data THEN 'INVALID_STAR_DATA' END,
      CASE WHEN refresh.has_incomplete_data THEN 'INCOMPLETE_STAR_DATA' END
    ]::text[], NULL),
    p_refreshed_at,
    refresh.entry_count,
    refresh.gold_source_core_ids,
    refresh.blue_source_core_ids,
    refresh.gold_data_complete,
    refresh.blue_data_complete,
    refresh.gold_star_eligible
      AND refresh.gold_assignment_count = 1
      AND refresh.gold_data_complete,
    refresh.blue_assignment_count = 1
      AND refresh.blue_data_complete
  FROM star_event_refresh refresh;

  GET DIAGNOSTICS v_event_count = ROW_COUNT;

  DELETE FROM dna.core_star_profile WHERE owner_id = v_owner_id;

  INSERT INTO dna.core_star_profile (
    owner_id,
    source_core_id,
    mode,
    distance,
    data_current_through,
    race_count,
    complete_star_data_race_count,
    partial_star_data_race_count,
    missing_star_data_race_count,
    invalid_star_data_race_count,
    gold_eligible_race_count,
    gold_assignment_opportunity_count,
    gold_received_count,
    gold_negative_opportunity_count,
    gold_eligible_no_assignment_count,
    gold_ineligible_assignment_count,
    gold_excluded_anomaly_count,
    blue_assignment_opportunity_count,
    blue_received_count,
    blue_negative_opportunity_count,
    blue_no_assignment_count,
    blue_excluded_anomaly_count,
    same_core_received_both_count,
    refreshed_at
  )
  SELECT
    v_owner_id,
    entry.source_core_id,
    event.mode,
    event.distance,
    max(event.event_at),
    count(*)::bigint,
    count(*) FILTER (WHERE entry.star_data_status = 'complete')::bigint,
    count(*) FILTER (WHERE entry.star_data_status = 'partial')::bigint,
    count(*) FILTER (WHERE entry.star_data_status = 'missing')::bigint,
    count(*) FILTER (WHERE entry.star_data_status = 'invalid')::bigint,
    count(*) FILTER (WHERE validation.gold_star_eligible)::bigint,
    count(*) FILTER (WHERE validation.gold_assignment_opportunity)::bigint,
    count(*) FILTER (
      WHERE validation.gold_assignment_opportunity
        AND validation.gold_source_core_id = entry.source_core_id
    )::bigint,
    count(*) FILTER (
      WHERE validation.gold_assignment_opportunity
        AND validation.gold_source_core_id <> entry.source_core_id
    )::bigint,
    count(*) FILTER (
      WHERE validation.gold_star_eligible
        AND validation.gold_data_complete
        AND validation.gold_assignment_count = 0
    )::bigint,
    count(*) FILTER (
      WHERE NOT validation.gold_star_eligible AND entry.gold_star IS TRUE
    )::bigint,
    count(*) FILTER (
      WHERE validation.gold_star_eligible
        AND NOT validation.gold_assignment_opportunity
        AND NOT (
          validation.gold_data_complete
          AND validation.gold_assignment_count = 0
        )
    )::bigint,
    count(*) FILTER (WHERE validation.blue_assignment_opportunity)::bigint,
    count(*) FILTER (
      WHERE validation.blue_assignment_opportunity
        AND validation.blue_source_core_id = entry.source_core_id
    )::bigint,
    count(*) FILTER (
      WHERE validation.blue_assignment_opportunity
        AND validation.blue_source_core_id <> entry.source_core_id
    )::bigint,
    count(*) FILTER (
      WHERE validation.blue_data_complete
        AND validation.blue_assignment_count = 0
    )::bigint,
    count(*) FILTER (
      WHERE NOT validation.blue_assignment_opportunity
        AND NOT (
          validation.blue_data_complete
          AND validation.blue_assignment_count = 0
        )
    )::bigint,
    count(*) FILTER (
      WHERE validation.gold_assignment_opportunity
        AND validation.blue_assignment_opportunity
        AND validation.same_core_received_both
        AND validation.gold_source_core_id = entry.source_core_id
    )::bigint,
    p_refreshed_at
  FROM dna.race_entry entry
  JOIN dna.race_event event
    ON event.owner_id = entry.owner_id
    AND event.id = entry.race_event_id
    AND event.active_in_dataset
  JOIN dna.event_star_validation validation
    ON validation.owner_id = event.owner_id
    AND validation.race_event_id = event.id
  WHERE entry.owner_id = v_owner_id AND entry.active_in_dataset
  GROUP BY entry.source_core_id, event.mode, event.distance;

  GET DIAGNOSTICS v_profile_count = ROW_COUNT;

  UPDATE dna.dataset_version
  SET aggregate_refreshed_at = p_refreshed_at
  WHERE owner_id = v_owner_id AND id = v_version.id;

  UPDATE dna.aggregate_refresh_job
  SET
    status = 'completed',
    completed_at = p_refreshed_at,
    affected_record_count = v_event_count + v_profile_count,
    failure_code = NULL
  WHERE owner_id = v_owner_id AND dataset_version_id = v_version.id;

  RETURN QUERY SELECT v_event_count, v_profile_count;
END
$function$;

REVOKE ALL ON TABLE dna.core_star_profile FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_star_profiles(uuid, timestamptz) FROM PUBLIC;

COMMIT;
