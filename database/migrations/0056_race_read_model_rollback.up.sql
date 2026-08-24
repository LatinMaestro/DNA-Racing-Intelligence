BEGIN;

ALTER FUNCTION dna.rollback_active_dataset(text, text, timestamptz)
  RENAME TO rollback_active_dataset_pre_read_model;

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
BEGIN
  SELECT rollback.rolled_back_version_number, rollback.restored_version_number
  INTO v_rolled_back_version, v_restored_version
  FROM dna.rollback_active_dataset_pre_read_model(
    p_source_type,
    p_reason,
    p_rolled_back_at
  ) rollback;

  IF p_source_type = 'race_merge' THEN
    UPDATE dna.race_entry entry
    SET
      active_in_dataset = EXISTS (
        SELECT 1
        FROM dna.dataset_version version
        WHERE version.owner_id = entry.owner_id
          AND version.source_type = 'race_merge'
          AND version.import_batch_id = entry.source_import_batch_id
          AND version.rolled_back_at IS NULL
      ),
      updated_at = p_rolled_back_at
    WHERE entry.owner_id = v_owner_id;

    UPDATE dna.race_event event
    SET
      active_in_dataset = EXISTS (
        SELECT 1
        FROM dna.race_entry entry
        WHERE entry.owner_id = event.owner_id
          AND entry.race_event_id = event.id
          AND entry.active_in_dataset
      ),
      updated_at = p_rolled_back_at
    WHERE event.owner_id = v_owner_id;
  END IF;

  RETURN QUERY SELECT v_rolled_back_version, v_restored_version;
END
$function$;

REVOKE ALL ON FUNCTION dna.rollback_active_dataset_pre_read_model(
  text, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset(
  text, text, timestamptz
) FROM PUBLIC;

COMMIT;
