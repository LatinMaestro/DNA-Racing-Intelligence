BEGIN;

CREATE FUNCTION dna.read_dna_open_lab_p5_recovery_fingerprints(
  p_owner_id uuid
)
RETURNS TABLE (
  evidence_group text,
  row_count bigint,
  fingerprint_payload text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab P5 recovery fingerprint read denied';
  END IF;

  RETURN QUERY
  WITH relation_fingerprints AS (
    SELECT 'owner_data'::text AS group_name,
      'dna_open_lab_active_race_snapshot'::text AS relation_name,
      count(*)::bigint AS relation_row_count,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), '')) AS relation_digest
    FROM dna.dna_open_lab_active_race_snapshot source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'owner_data', 'dna_open_lab_core_supplemental_snapshot', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_core_supplemental_snapshot source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'owner_data', 'dna_open_lab_owned_core_snapshot', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_owned_core_snapshot source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'owner_data', 'dna_open_lab_race_fill_snapshot', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_race_fill_snapshot source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'owner_data', 'dna_open_lab_splice_arena_listing_snapshot', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_splice_arena_listing_snapshot source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'owner_data', 'dna_open_lab_splice_arena_mode_snapshot', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_splice_arena_mode_snapshot source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'owner_data', 'dna_open_lab_splice_arena_page_snapshot', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_splice_arena_page_snapshot source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'owner_data', 'dna_open_lab_token_prices_snapshot', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_token_prices_snapshot source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'checkpoint_state', 'dna_open_lab_current_state_acquisition_cycle', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_current_state_acquisition_cycle source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'checkpoint_state', 'dna_open_lab_finished_race_backfill_checkpoint', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_finished_race_backfill_checkpoint source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'serving_state', 'dna_open_lab_sync_generation', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_sync_generation source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'serving_state', 'dna_open_lab_sync_state', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_sync_state source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'retained_evidence', 'dna_open_lab_current_state_evidence_index', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_current_state_evidence_index source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'retained_evidence', 'dna_open_lab_finished_race_window_receipt', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_finished_race_window_receipt source_row
    WHERE source_row.owner_id = p_owner_id
    UNION ALL
    SELECT 'retained_evidence', 'dna_open_lab_sync_family', count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(source_row)::text), ','
        ORDER BY md5(to_jsonb(source_row)::text)), ''))
    FROM dna.dna_open_lab_sync_family source_row
    WHERE source_row.owner_id = p_owner_id
  )
  SELECT grouped.group_name,
    sum(grouped.relation_row_count)::bigint,
    jsonb_agg(
      jsonb_build_object(
        'relation', grouped.relation_name,
        'row_count', grouped.relation_row_count,
        'relation_digest', grouped.relation_digest
      ) ORDER BY grouped.relation_name
    )::text
  FROM relation_fingerprints grouped
  GROUP BY grouped.group_name
  ORDER BY grouped.group_name;
END
$function$;

REVOKE ALL ON FUNCTION dna.read_dna_open_lab_p5_recovery_fingerprints(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_p5_recovery_fingerprints(uuid)
TO dna_app_runtime;

COMMIT;
