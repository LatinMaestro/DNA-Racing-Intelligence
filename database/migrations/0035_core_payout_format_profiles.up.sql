BEGIN;

CREATE FUNCTION dna.payout_format_key(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT lower(regexp_replace(btrim(p_label), '[[:space:]]+', ' ', 'g'))
$function$;

CREATE TABLE dna.core_payout_format_profile (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_core_id text NOT NULL CHECK (NULLIF(btrim(source_core_id), '') IS NOT NULL),
  mode text NOT NULL CHECK (mode IN ('bike', 'car', 'horse')),
  payout_format_key text NOT NULL CHECK (
    NULLIF(btrim(payout_format_key), '') IS NOT NULL
    AND payout_format_key = dna.payout_format_key(payout_format_key)
  ),
  payout_format_label text NOT NULL CHECK (NULLIF(btrim(payout_format_label), '') IS NOT NULL),
  data_current_through timestamptz NOT NULL,
  first_event_at timestamptz NOT NULL,
  race_count bigint NOT NULL CHECK (race_count > 0),
  win_count bigint NOT NULL CHECK (win_count >= 0 AND win_count <= race_count),
  top_three_count bigint NOT NULL CHECK (
    top_three_count >= win_count AND top_three_count <= race_count
  ),
  exact_distance_count integer NOT NULL CHECK (exact_distance_count > 0),
  timed_race_count bigint NOT NULL CHECK (
    timed_race_count >= 0 AND timed_race_count <= race_count
  ),
  refreshed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, source_core_id, mode, payout_format_key),
  CHECK (first_event_at <= data_current_through)
);

CREATE INDEX core_payout_format_profile_owner_core
  ON dna.core_payout_format_profile(
    owner_id,
    source_core_id,
    mode,
    payout_format_key
  );

ALTER TABLE dna.core_payout_format_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.core_payout_format_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.core_payout_format_profile
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

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
      dna.payout_format_key(source.raw_payout) AS payout_format_key
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
    WHERE
      source.owner_id = v_owner_id
      AND source.is_selected_fact
      AND NULLIF(btrim(source.raw_payout), '') IS NOT NULL
    ORDER BY
      source.race_entry_id,
      version.version_number DESC,
      source.source_row_number DESC NULLS LAST,
      source.id DESC
  )
  SELECT count(*) INTO v_entry_count FROM selected_source;

  DELETE FROM dna.core_payout_format_profile
  WHERE owner_id = v_owner_id;

  WITH selected_source AS (
    SELECT DISTINCT ON (source.race_entry_id)
      source.race_entry_id,
      dna.payout_format_key(source.raw_payout) AS payout_format_key,
      btrim(regexp_replace(source.raw_payout, '[[:space:]]+', ' ', 'g')) AS payout_format_label
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
    WHERE
      source.owner_id = v_owner_id
      AND source.is_selected_fact
      AND NULLIF(btrim(source.raw_payout), '') IS NOT NULL
    ORDER BY
      source.race_entry_id,
      version.version_number DESC,
      source.source_row_number DESC NULLS LAST,
      source.id DESC
  )
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
    source.payout_format_key,
    min(source.payout_format_label),
    max(event.event_at),
    min(event.event_at),
    count(*),
    count(*) FILTER (WHERE entry.finish_position = 1),
    count(*) FILTER (WHERE entry.finish_position <= 3),
    count(DISTINCT event.distance)::integer,
    count(entry.elapsed_time_milliseconds),
    p_refreshed_at
  FROM selected_source source
  JOIN dna.race_entry entry
    ON entry.owner_id = v_owner_id
    AND entry.id = source.race_entry_id
    AND entry.active_in_dataset
  JOIN dna.race_event event
    ON event.owner_id = entry.owner_id
    AND event.id = entry.race_event_id
    AND event.active_in_dataset
  GROUP BY
    entry.source_core_id,
    event.mode,
    source.payout_format_key;

  GET DIAGNOSTICS v_profile_count = ROW_COUNT;
  RETURN QUERY SELECT v_entry_count, v_profile_count;
END
$function$;

CREATE FUNCTION dna.list_core_payout_format_profiles(
  p_owner_id uuid,
  p_source_core_id text,
  p_limit integer
)
RETURNS TABLE (
  core_id text,
  mode text,
  payout_format_key text,
  payout_format_label text,
  data_current_through timestamptz,
  first_event_at timestamptz,
  race_count bigint,
  win_count bigint,
  top_three_count bigint,
  exact_distance_count integer,
  timed_race_count bigint,
  refreshed_at timestamptz,
  last_imported_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
BEGIN
  IF v_owner_id IS NULL OR p_owner_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner-scoped payout-format read denied';
  END IF;
  IF p_source_core_id IS NOT NULL AND (
    p_source_core_id = ''
    OR p_source_core_id <> btrim(p_source_core_id)
    OR length(p_source_core_id) > 256
  ) THEN
    RAISE EXCEPTION 'payout-format Core ID is invalid';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'payout-format result limit is invalid';
  END IF;

  RETURN QUERY
  SELECT
    profile.source_core_id,
    profile.mode,
    profile.payout_format_key,
    profile.payout_format_label,
    profile.data_current_through,
    profile.first_event_at,
    profile.race_count,
    profile.win_count,
    profile.top_three_count,
    profile.exact_distance_count,
    profile.timed_race_count,
    profile.refreshed_at,
    (
      SELECT max(batch.import_completed_at)
      FROM dna.import_batch batch
      WHERE
        batch.owner_id = p_owner_id
        AND batch.source_type = 'race_merge'
        AND batch.status = 'accepted'
    )
  FROM dna.core_payout_format_profile profile
  WHERE
    profile.owner_id = p_owner_id
    AND (
      p_source_core_id IS NOT NULL
      AND profile.source_core_id = p_source_core_id
      OR p_source_core_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM dna.owner_vault_core vault
        JOIN dna.core core
          ON core.owner_id = vault.owner_id
          AND core.id = vault.core_id
        WHERE
          vault.owner_id = profile.owner_id
          AND vault.in_my_vault
          AND core.source_core_id = profile.source_core_id
      )
    )
  ORDER BY
    profile.source_core_id,
    profile.mode,
    profile.payout_format_key
  LIMIT p_limit;
END
$function$;

REVOKE ALL ON FUNCTION dna.payout_format_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.refresh_core_payout_format_profiles(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_core_payout_format_profiles(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON TABLE dna.core_payout_format_profile FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.list_core_payout_format_profiles(
  uuid,
  text,
  integer
) TO dna_app_runtime;

COMMIT;
