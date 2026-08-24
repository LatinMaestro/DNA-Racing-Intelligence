BEGIN;

ALTER TABLE dna.race_entry
  ADD COLUMN payout_format_label text CHECK (
    payout_format_label IS NULL
    OR NULLIF(btrim(payout_format_label), '') IS NOT NULL
  );

WITH selected_source AS (
  SELECT DISTINCT ON (source.race_entry_id)
    source.race_entry_id,
    btrim(regexp_replace(source.raw_payout, '[[:space:]]+', ' ', 'g'))
      AS payout_format_label
  FROM dna.race_entry_source source
  JOIN dna.dataset_version version
    ON version.owner_id = source.owner_id
    AND version.import_batch_id = source.import_batch_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
  JOIN dna.race_entry entry
    ON entry.owner_id = source.owner_id
    AND entry.id = source.race_entry_id
    AND entry.active_in_dataset
  WHERE source.is_selected_fact
    AND NULLIF(btrim(source.raw_payout), '') IS NOT NULL
  ORDER BY
    source.race_entry_id,
    version.version_number DESC,
    source.source_row_number DESC NULLS LAST,
    source.id DESC
)
UPDATE dna.race_entry entry
SET payout_format_label = selected.payout_format_label
FROM selected_source selected
WHERE entry.id = selected.race_entry_id
  AND entry.payout_format_label IS DISTINCT FROM selected.payout_format_label;

ALTER FUNCTION dna.refresh_core_payout_format_profiles(timestamptz)
  RENAME TO refresh_core_payout_format_profiles_pre_read_model;

CREATE FUNCTION dna.refresh_core_payout_format_profiles(
  p_refreshed_at timestamptz
)
RETURNS TABLE (
  accepted_format_entry_count bigint,
  payout_format_profile_count bigint
)
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_entry_count bigint := 0;
  v_profile_count bigint := 0;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for payout-format refresh';
  END IF;
  IF p_refreshed_at IS NULL THEN
    RAISE EXCEPTION 'payout-format refresh timestamp is required';
  END IF;

  WITH selected_source AS (
    SELECT DISTINCT ON (source.race_entry_id)
      source.race_entry_id,
      btrim(regexp_replace(source.raw_payout, '[[:space:]]+', ' ', 'g'))
        AS payout_format_label
    FROM dna.race_entry_source source
    JOIN dna.dataset_version version
      ON version.owner_id = source.owner_id
      AND version.import_batch_id = source.import_batch_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
    JOIN dna.race_entry entry
      ON entry.owner_id = source.owner_id
      AND entry.id = source.race_entry_id
      AND entry.active_in_dataset
    WHERE source.owner_id = v_owner_id
      AND source.is_selected_fact
      AND NULLIF(btrim(source.raw_payout), '') IS NOT NULL
    ORDER BY
      source.race_entry_id,
      version.version_number DESC,
      source.source_row_number DESC NULLS LAST,
      source.id DESC
  )
  UPDATE dna.race_entry entry
  SET
    payout_format_label = selected.payout_format_label,
    updated_at = GREATEST(entry.updated_at, p_refreshed_at)
  FROM selected_source selected
  WHERE entry.owner_id = v_owner_id
    AND entry.id = selected.race_entry_id
    AND entry.payout_format_label IS DISTINCT FROM selected.payout_format_label;

  SELECT count(*)
  INTO v_entry_count
  FROM dna.race_entry entry
  WHERE entry.owner_id = v_owner_id
    AND entry.active_in_dataset
    AND entry.payout_format_label IS NOT NULL;

  DELETE FROM dna.core_payout_format_profile
  WHERE owner_id = v_owner_id;

  INSERT INTO dna.core_payout_format_profile (
    owner_id,
    source_core_id,
    mode,
    payout_format_key,
    payout_format_label,
    data_current_through,
    first_event_at,
    race_count,
    win_count,
    top_three_count,
    exact_distance_count,
    timed_race_count,
    refreshed_at
  )
  SELECT
    v_owner_id,
    entry.source_core_id,
    event.mode,
    dna.payout_format_key(entry.payout_format_label),
    min(entry.payout_format_label),
    max(event.event_at),
    min(event.event_at),
    count(*),
    count(*) FILTER (WHERE entry.finish_position = 1),
    count(*) FILTER (WHERE entry.finish_position <= 3),
    count(DISTINCT event.distance)::integer,
    count(entry.elapsed_time_milliseconds),
    p_refreshed_at
  FROM dna.race_entry entry
  JOIN dna.race_event event
    ON event.owner_id = entry.owner_id
    AND event.id = entry.race_event_id
    AND event.active_in_dataset
  WHERE entry.owner_id = v_owner_id
    AND entry.active_in_dataset
    AND entry.payout_format_label IS NOT NULL
  GROUP BY
    entry.source_core_id,
    event.mode,
    dna.payout_format_key(entry.payout_format_label);

  GET DIAGNOSTICS v_profile_count = ROW_COUNT;
  RETURN QUERY SELECT v_entry_count, v_profile_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.refresh_core_payout_format_profiles_pre_read_model(
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_core_payout_format_profiles(timestamptz)
  FROM PUBLIC;

COMMIT;
