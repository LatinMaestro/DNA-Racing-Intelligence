BEGIN;

CREATE FUNCTION dna.read_dna_open_lab_combined_serving_finished_history(
  p_owner_id uuid
)
RETURNS TABLE (
  refresh_cycle_id text,
  current_state_generation_id uuid,
  selected_cycle_id text,
  lineage_depth integer,
  cycle_id text,
  previous_published_cycle_id text,
  attempt_number integer,
  lower_bound_at timestamptz,
  upper_bound_at timestamptz,
  receipt_count integer,
  document_count bigint,
  publication_manifest_byte_length bigint,
  receipt_set_sha256 text,
  validated_at timestamptz,
  published_at timestamptz,
  first_attempt_number integer,
  window_start_at timestamptz,
  window_end_at timestamptz,
  window_key text,
  content_sha256 text,
  window_document_count integer,
  manifest_object_key text,
  manifest_body_sha256 text,
  manifest_byte_length bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped combined finished-history read denied';
  END IF;

  RETURN QUERY
  WITH RECURSIVE selected AS (
    SELECT combined.refresh_cycle_id, combined.current_state_generation_id,
      combined.finished_history_cycle_id
    FROM dna.dna_open_lab_daily_refresh_active active
    JOIN dna.dna_open_lab_daily_refresh_generation combined
      ON combined.owner_id = active.owner_id
     AND combined.refresh_cycle_id = active.refresh_cycle_id
    WHERE active.owner_id = p_owner_id
  ), lineage AS (
    SELECT publication.*, 0::integer AS depth,
      ARRAY[publication.cycle_id::text]::text[] AS visited
    FROM selected
    JOIN dna.dna_open_lab_finished_race_incremental_publication publication
      ON publication.owner_id = p_owner_id
     AND publication.cycle_id = selected.finished_history_cycle_id
    UNION ALL
    SELECT predecessor.*, lineage.depth + 1,
      lineage.visited || predecessor.cycle_id::text
    FROM lineage
    JOIN dna.dna_open_lab_finished_race_incremental_publication predecessor
      ON predecessor.owner_id = lineage.owner_id
     AND predecessor.cycle_id = lineage.previous_published_cycle_id
    WHERE NOT predecessor.cycle_id::text = ANY(lineage.visited)
  )
  SELECT selected.refresh_cycle_id::text,
    selected.current_state_generation_id,
    selected.finished_history_cycle_id::text,
    lineage.depth,
    lineage.cycle_id::text,
    lineage.previous_published_cycle_id::text,
    lineage.attempt_number::integer,
    lineage.lower_bound_at,
    lineage.upper_bound_at,
    lineage.receipt_count,
    lineage.document_count,
    lineage.manifest_byte_length,
    lineage.receipt_set_sha256::text,
    lineage.validated_at,
    lineage.published_at,
    receipt.first_attempt_number::integer,
    receipt.window_start_at,
    receipt.window_end_at,
    receipt.window_key::text,
    receipt.content_sha256::text,
    receipt.document_count,
    receipt.manifest_object_key,
    receipt.manifest_body_sha256::text,
    receipt.manifest_byte_length
  FROM selected
  JOIN lineage ON true
  JOIN dna.dna_open_lab_finished_race_incremental_window_receipt receipt
    ON receipt.owner_id = lineage.owner_id
   AND receipt.cycle_id = lineage.cycle_id
   AND receipt.first_attempt_number <= lineage.attempt_number
  ORDER BY lineage.depth DESC, receipt.window_start_at,
    receipt.window_end_at, receipt.window_key;
END
$function$;

REVOKE ALL ON FUNCTION
  dna.read_dna_open_lab_combined_serving_finished_history(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.read_dna_open_lab_combined_serving_finished_history(uuid)
TO dna_app_runtime;

COMMIT;
