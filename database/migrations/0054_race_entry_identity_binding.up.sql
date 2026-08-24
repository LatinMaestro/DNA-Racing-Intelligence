BEGIN;

ALTER TABLE dna.race_entry
  ADD COLUMN source_fingerprint_sha256 bytea CHECK (
    source_fingerprint_sha256 IS NULL
    OR octet_length(source_fingerprint_sha256) = 32
  );

UPDATE dna.race_entry entry
SET source_fingerprint_sha256 = decode(record.fingerprint_sha256, 'hex')
FROM dna.race_event event,
  dna.dataset_version_record record,
  dna.dataset_version version
WHERE event.owner_id = entry.owner_id
  AND event.id = entry.race_event_id
  AND record.owner_id = entry.owner_id
  AND record.source_type = 'race_merge'
  AND record.natural_key = event.source_event_id || ':' || entry.source_core_id
  AND record.first_accepted_batch_id = entry.source_import_batch_id
  AND version.owner_id = record.owner_id
  AND version.id = record.dataset_version_id
  AND version.rolled_back_at IS NULL;

DO $active_identity_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.active_in_dataset
      AND entry.source_fingerprint_sha256 IS NULL
  ) THEN
    RAISE EXCEPTION 'active Race Merge entry identity could not be backfilled';
  END IF;
END
$active_identity_backfill$;

ALTER FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) RENAME TO accept_staged_race_dataset_pre_identity;

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
  v_result record;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.accept_staged_race_dataset_pre_identity(
    p_import_batch_id,
    p_dataset_version_id,
    p_import_completed_at,
    p_activated_at,
    p_data_current_through
  );

  IF v_result.result_status = 'quarantined' THEN
    RETURN QUERY SELECT
      v_result.result_status,
      v_result.activated_version_number,
      v_result.materialized_event_count,
      v_result.materialized_entry_count;
    RETURN;
  END IF;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for race identity binding';
  END IF;

  IF EXISTS (
    WITH candidates AS (
      SELECT DISTINCT ON (entry.id)
        entry.id AS race_entry_id,
        entry.source_import_batch_id,
        entry.source_fingerprint_sha256,
        decode(staged.fingerprint_sha256, 'hex') AS staged_fingerprint,
        source_version.rolled_back_at AS source_version_rolled_back_at
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
      LEFT JOIN dna.dataset_version source_version
        ON source_version.owner_id = entry.owner_id
        AND source_version.import_batch_id = entry.source_import_batch_id
      WHERE fact.owner_id = v_owner_id
        AND fact.import_batch_id = p_import_batch_id
        AND staged.status = 'ready'
      ORDER BY entry.id, fact.source_row_number
    )
    SELECT 1
    FROM candidates candidate
    WHERE candidate.source_version_rolled_back_at IS NOT NULL
      AND candidate.source_fingerprint_sha256 IS NOT NULL
      AND candidate.source_fingerprint_sha256 <> candidate.staged_fingerprint
  ) THEN
    RAISE EXCEPTION
      'rolled-back Race Merge identity mutation requires evidence rebuild';
  END IF;

  WITH candidates AS (
    SELECT DISTINCT ON (entry.id)
      entry.id AS race_entry_id,
      decode(staged.fingerprint_sha256, 'hex') AS staged_fingerprint,
      source_version.rolled_back_at AS source_version_rolled_back_at
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
    LEFT JOIN dna.dataset_version source_version
      ON source_version.owner_id = entry.owner_id
      AND source_version.import_batch_id = entry.source_import_batch_id
    WHERE fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
    ORDER BY entry.id, fact.source_row_number
  )
  UPDATE dna.race_entry entry
  SET
    source_import_batch_id = CASE
      WHEN candidate.source_version_rolled_back_at IS NOT NULL
        THEN p_import_batch_id
      ELSE entry.source_import_batch_id
    END,
    source_fingerprint_sha256 = COALESCE(
      entry.source_fingerprint_sha256,
      candidate.staged_fingerprint
    ),
    updated_at = GREATEST(entry.updated_at, p_activated_at)
  FROM candidates candidate
  WHERE entry.owner_id = v_owner_id
    AND entry.id = candidate.race_entry_id;

  IF EXISTS (
    SELECT 1
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
    WHERE fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND entry.source_fingerprint_sha256 IS DISTINCT FROM
        decode(staged.fingerprint_sha256, 'hex')
  ) THEN
    RAISE EXCEPTION 'Race Merge entry fingerprint conflicts with bound identity';
  END IF;

  RETURN QUERY SELECT
    v_result.result_status,
    v_result.activated_version_number,
    v_result.materialized_event_count,
    v_result.materialized_entry_count;
END
$function$;

REVOKE ALL ON FUNCTION dna.accept_staged_race_dataset_pre_identity(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;

COMMIT;
