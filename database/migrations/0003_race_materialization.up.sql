BEGIN;

ALTER TABLE dna.race_event
  ADD COLUMN active_in_dataset boolean NOT NULL DEFAULT true;

ALTER TABLE dna.race_entry
  ADD COLUMN active_in_dataset boolean NOT NULL DEFAULT true;

ALTER TABLE dna.race_entry_source
  ADD COLUMN source_event_datetime timestamptz,
  ADD COLUMN source_core_name text,
  ADD COLUMN source_gate smallint CHECK (
    source_gate IS NULL OR source_gate > 0
  ),
  ADD COLUMN raw_elapsed_time text,
  ADD COLUMN raw_prize text,
  ADD COLUMN raw_asset text,
  ADD COLUMN source_format_label text,
  ADD COLUMN source_race_class text;

CREATE TABLE dna.normalized_race_staged_fact (
  owner_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  source_event_id text NOT NULL CHECK (NULLIF(btrim(source_event_id), '') IS NOT NULL),
  event_at timestamptz NOT NULL,
  source_event_datetime timestamptz,
  mode text NOT NULL CHECK (mode IN ('bike', 'car', 'horse')),
  distance integer NOT NULL CHECK (distance > 0),
  source_core_id text NOT NULL CHECK (NULLIF(btrim(source_core_id), '') IS NOT NULL),
  source_core_name text,
  source_gate smallint CHECK (source_gate IS NULL OR source_gate > 0),
  gate_count smallint NOT NULL CHECK (gate_count > 0),
  gold_star boolean,
  blue_star boolean,
  raw_gold_star text NOT NULL,
  raw_blue_star text NOT NULL,
  star_data_status text NOT NULL CHECK (
    star_data_status IN ('complete', 'partial', 'missing', 'invalid')
  ),
  finish_position smallint NOT NULL CHECK (finish_position > 0),
  elapsed_time_source_value text NOT NULL CHECK (
    elapsed_time_source_value ~ '^[0-9]+(\.[0-9]+)?$'
    AND elapsed_time_source_value !~ '^0(\.0+)?$'
  ),
  source_format_label text,
  source_race_class text,
  raw_entry_fee text,
  raw_payout text,
  raw_prize text,
  raw_asset text,
  economic_data_status text NOT NULL DEFAULT 'unvalidated' CHECK (
    economic_data_status = 'unvalidated'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, import_batch_id, source_row_number),
  FOREIGN KEY (owner_id, import_batch_id, source_row_number)
    REFERENCES dna.dataset_staged_record(
      owner_id,
      import_batch_id,
      source_row_number
    ) ON DELETE CASCADE,
  CHECK (source_gate IS NULL OR source_gate <= gate_count),
  CHECK (
    (star_data_status = 'complete' AND gold_star IS NOT NULL AND blue_star IS NOT NULL)
    OR (
      star_data_status = 'partial'
      AND num_nonnulls(gold_star, blue_star) = 1
    )
    OR (star_data_status = 'missing' AND gold_star IS NULL AND blue_star IS NULL)
    OR (star_data_status = 'invalid' AND (gold_star IS NULL OR blue_star IS NULL))
  )
);

CREATE INDEX normalized_race_staged_fact_event
  ON dna.normalized_race_staged_fact(
    owner_id,
    import_batch_id,
    source_event_id
  );

ALTER TABLE dna.normalized_race_staged_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.normalized_race_staged_fact FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.normalized_race_staged_fact
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.accept_staged_race_dataset(
  p_import_batch_id uuid,
  p_dataset_version_id uuid,
  p_import_completed_at timestamptz,
  p_activated_at timestamptz,
  p_data_current_through timestamptz
)
RETURNS TABLE (
  result_status text,
  activated_version_number bigint,
  materialized_event_count bigint,
  materialized_entry_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_batch dna.import_batch%ROWTYPE;
  v_result_status text;
  v_version_number bigint;
  v_ready_count bigint;
  v_fact_count bigint;
  v_event_count bigint := 0;
  v_entry_count bigint := 0;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for race acceptance';
  END IF;

  SELECT *
  INTO v_batch
  FROM dna.import_batch
  WHERE owner_id = v_owner_id AND id = p_import_batch_id
  FOR UPDATE;

  IF NOT FOUND OR v_batch.source_type <> 'race_merge' THEN
    RAISE EXCEPTION 'owner-scoped Race Merge import batch does not exist';
  END IF;

  SELECT count(*)
  INTO v_ready_count
  FROM dna.dataset_staged_record
  WHERE
    owner_id = v_owner_id
    AND import_batch_id = p_import_batch_id
    AND status = 'ready';

  SELECT count(*)
  INTO v_fact_count
  FROM dna.normalized_race_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready';

  IF v_ready_count <> v_fact_count THEN
    RAISE EXCEPTION 'every ready Race Merge row requires one normalized fact';
  END IF;

  IF v_batch.status = 'validating' THEN
    WITH inconsistent_events AS (
      SELECT fact.source_event_id
      FROM dna.normalized_race_staged_fact fact
      JOIN dna.dataset_staged_record staged
        ON staged.owner_id = fact.owner_id
        AND staged.import_batch_id = fact.import_batch_id
        AND staged.source_row_number = fact.source_row_number
      WHERE
        fact.owner_id = v_owner_id
        AND fact.import_batch_id = p_import_batch_id
        AND staged.status = 'ready'
      GROUP BY fact.source_event_id
      HAVING count(
        DISTINCT ROW(
          fact.event_at,
          fact.mode,
          fact.distance,
          fact.gate_count
        )
      ) > 1
    ),
    existing_conflicts AS (
      SELECT DISTINCT fact.source_event_id
      FROM dna.normalized_race_staged_fact fact
      JOIN dna.dataset_staged_record staged
        ON staged.owner_id = fact.owner_id
        AND staged.import_batch_id = fact.import_batch_id
        AND staged.source_row_number = fact.source_row_number
      JOIN dna.race_event event
        ON event.owner_id = fact.owner_id
        AND event.source_event_id = fact.source_event_id
      WHERE
        fact.owner_id = v_owner_id
        AND fact.import_batch_id = p_import_batch_id
        AND staged.status = 'ready'
        AND (
          event.event_at <> fact.event_at
          OR event.mode <> fact.mode
          OR event.distance <> fact.distance
          OR event.gate_count <> fact.gate_count
        )
    ),
    conflicts AS (
      SELECT source_event_id FROM inconsistent_events
      UNION
      SELECT source_event_id FROM existing_conflicts
    )
    UPDATE dna.dataset_staged_record staged
    SET
      status = 'quarantined',
      issue_codes = CASE
        WHEN staged.issue_codes @> ARRAY['EVENT_METADATA_CONFLICT']
          THEN staged.issue_codes
        ELSE array_append(staged.issue_codes, 'EVENT_METADATA_CONFLICT')
      END
    FROM dna.normalized_race_staged_fact fact
    JOIN conflicts conflict
      ON conflict.source_event_id = fact.source_event_id
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND fact.owner_id = staged.owner_id
      AND fact.import_batch_id = staged.import_batch_id
      AND fact.source_row_number = staged.source_row_number;
  END IF;

  SELECT accepted.result_status, accepted.activated_version_number
  INTO v_result_status, v_version_number
  FROM dna.accept_staged_dataset(
    p_import_batch_id,
    p_dataset_version_id,
    p_import_completed_at,
    p_activated_at,
    p_data_current_through
  ) accepted;

  IF v_result_status = 'quarantined' THEN
    RETURN QUERY SELECT v_result_status, v_version_number, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  WITH event_candidates AS (
    SELECT DISTINCT ON (fact.source_event_id)
      fact.source_event_id,
      fact.event_at,
      fact.mode,
      fact.distance,
      fact.gate_count,
      fact.source_format_label,
      fact.source_race_class
    FROM dna.normalized_race_staged_fact fact
    JOIN dna.dataset_staged_record staged
      ON staged.owner_id = fact.owner_id
      AND staged.import_batch_id = fact.import_batch_id
      AND staged.source_row_number = fact.source_row_number
    WHERE
      fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
    ORDER BY fact.source_event_id, fact.source_row_number
  )
  INSERT INTO dna.race_event (
    id,
    owner_id,
    source_event_id,
    event_at,
    mode,
    distance,
    gate_count,
    source_format_label,
    source_race_class,
    source_import_batch_id,
    active_in_dataset,
    created_at,
    updated_at
  )
  SELECT
    md5(v_owner_id::text || ':race_event:' || candidate.source_event_id)::uuid,
    v_owner_id,
    candidate.source_event_id,
    candidate.event_at,
    candidate.mode,
    candidate.distance,
    candidate.gate_count,
    candidate.source_format_label,
    candidate.source_race_class,
    p_import_batch_id,
    true,
    p_activated_at,
    p_activated_at
  FROM event_candidates candidate
  ON CONFLICT (owner_id, source_event_id) DO UPDATE
  SET
    active_in_dataset = true,
    updated_at = EXCLUDED.updated_at;

  SELECT count(DISTINCT fact.source_event_id)
  INTO v_event_count
  FROM dna.normalized_race_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready';

  INSERT INTO dna.race_entry AS existing_entry (
    id,
    owner_id,
    race_event_id,
    source_core_id,
    core_id,
    gate_count,
    gold_star,
    blue_star,
    star_data_status,
    elapsed_time_milliseconds,
    speed_microunits,
    finish_position,
    economic_data_status,
    source_import_batch_id,
    active_in_dataset,
    created_at,
    updated_at
  )
  SELECT DISTINCT ON (event.id, fact.source_core_id)
    md5(
      v_owner_id::text
      || ':race_entry:'
      || fact.source_event_id
      || ':'
      || fact.source_core_id
    )::uuid,
    v_owner_id,
    event.id,
    fact.source_core_id,
    core.id,
    fact.gate_count,
    fact.gold_star,
    fact.blue_star,
    fact.star_data_status,
    NULL,
    NULL,
    fact.finish_position,
    'unvalidated',
    p_import_batch_id,
    true,
    p_activated_at,
    p_activated_at
  FROM dna.normalized_race_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  JOIN dna.race_event event
    ON event.owner_id = fact.owner_id
    AND event.source_event_id = fact.source_event_id
  LEFT JOIN dna.core core
    ON core.owner_id = fact.owner_id
    AND core.source_core_id = fact.source_core_id
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready'
  ORDER BY event.id, fact.source_core_id, fact.source_row_number
  ON CONFLICT (owner_id, race_event_id, source_core_id) DO UPDATE
  SET
    core_id = COALESCE(existing_entry.core_id, EXCLUDED.core_id),
    active_in_dataset = true,
    updated_at = EXCLUDED.updated_at;

  SELECT count(DISTINCT ROW(fact.source_event_id, fact.source_core_id))
  INTO v_entry_count
  FROM dna.normalized_race_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready';

  INSERT INTO dna.race_entry_source (
    id,
    owner_id,
    race_entry_id,
    import_batch_id,
    source_row_number,
    source_row_checksum,
    raw_gold_star,
    raw_blue_star,
    raw_entry_fee,
    raw_payout,
    is_selected_fact,
    source_event_datetime,
    source_core_name,
    source_gate,
    raw_elapsed_time,
    raw_prize,
    raw_asset,
    source_format_label,
    source_race_class,
    created_at
  )
  SELECT DISTINCT ON (entry.id)
    md5(
      v_owner_id::text
      || ':race_entry_source:'
      || p_import_batch_id::text
      || ':'
      || fact.source_row_number::text
    )::uuid,
    v_owner_id,
    entry.id,
    p_import_batch_id,
    fact.source_row_number,
    staged.fingerprint_sha256,
    fact.raw_gold_star,
    fact.raw_blue_star,
    fact.raw_entry_fee,
    fact.raw_payout,
    true,
    fact.source_event_datetime,
    fact.source_core_name,
    fact.source_gate,
    fact.elapsed_time_source_value,
    fact.raw_prize,
    fact.raw_asset,
    fact.source_format_label,
    fact.source_race_class,
    p_activated_at
  FROM dna.normalized_race_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  JOIN dna.race_event event
    ON event.owner_id = fact.owner_id
    AND event.source_event_id = fact.source_event_id
  JOIN dna.race_entry entry
    ON entry.owner_id = event.owner_id
    AND entry.race_event_id = event.id
    AND entry.source_core_id = fact.source_core_id
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready'
  ORDER BY entry.id, fact.source_row_number
  ON CONFLICT (owner_id, race_entry_id, import_batch_id) DO UPDATE
  SET is_selected_fact = true;

  RETURN QUERY
  SELECT v_result_status, v_version_number, v_event_count, v_entry_count;
END
$function$;

ALTER FUNCTION dna.rollback_active_dataset(text, text, timestamptz)
  RENAME TO rollback_active_dataset_ledger;

CREATE FUNCTION dna.rollback_active_dataset(
  p_source_type text,
  p_reason text,
  p_rolled_back_at timestamptz
)
RETURNS TABLE (
  rolled_back_version_number bigint,
  restored_version_number bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_rolled_back_version bigint;
  v_restored_version bigint;
  v_rolled_back_batch_id uuid;
BEGIN
  SELECT rollback.rolled_back_version_number, rollback.restored_version_number
  INTO v_rolled_back_version, v_restored_version
  FROM dna.rollback_active_dataset_ledger(
    p_source_type,
    p_reason,
    p_rolled_back_at
  ) rollback;

  IF p_source_type = 'race_merge' THEN
    SELECT import_batch_id
    INTO v_rolled_back_batch_id
    FROM dna.dataset_version
    WHERE
      owner_id = v_owner_id
      AND source_type = 'race_merge'
      AND version_number = v_rolled_back_version;

    UPDATE dna.race_entry_source
    SET is_selected_fact = false
    WHERE
      owner_id = v_owner_id
      AND import_batch_id = v_rolled_back_batch_id;

    UPDATE dna.race_entry entry
    SET
      active_in_dataset = EXISTS (
        SELECT 1
        FROM dna.race_entry_source source
        JOIN dna.dataset_version version
          ON version.owner_id = source.owner_id
          AND version.import_batch_id = source.import_batch_id
          AND version.source_type = 'race_merge'
        WHERE
          source.owner_id = entry.owner_id
          AND source.race_entry_id = entry.id
          AND source.is_selected_fact
          AND version.rolled_back_at IS NULL
      ),
      updated_at = p_rolled_back_at
    WHERE entry.owner_id = v_owner_id;

    UPDATE dna.race_event event
    SET
      active_in_dataset = EXISTS (
        SELECT 1
        FROM dna.race_entry entry
        WHERE
          entry.owner_id = event.owner_id
          AND entry.race_event_id = event.id
          AND entry.active_in_dataset
      ),
      updated_at = p_rolled_back_at
    WHERE event.owner_id = v_owner_id;
  END IF;

  RETURN QUERY SELECT v_rolled_back_version, v_restored_version;
END
$function$;

REVOKE ALL ON TABLE dna.normalized_race_staged_fact FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.accept_staged_race_dataset(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset_ledger(
  text,
  text,
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset(
  text,
  text,
  timestamptz
) FROM PUBLIC;

COMMIT;
