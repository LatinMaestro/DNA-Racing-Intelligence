BEGIN;

CREATE FUNCTION dna.read_dna_open_lab_combined_serving_sync_state(p_owner_id uuid)
RETURNS TABLE (
  accepted_generation_id uuid,
  accepted_observed_at timestamptz,
  accepted_at timestamptz,
  serving_generation_id uuid,
  sync_status text,
  catch_up_required boolean,
  last_attempt_at timestamptz,
  last_interruption_reason text,
  last_interruption_at timestamptz,
  retry_after_seconds integer,
  last_catch_up_completed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped combined serving state read denied';
  END IF;
  RETURN QUERY
  SELECT served.id, served.observed_at, served.published_at, served.id,
    CASE
      WHEN live.serving_generation_id = served.id
       AND live.sync_status = 'current' THEN 'current'
      WHEN live.sync_status = 'paused' THEN 'paused'
      ELSE 'catching_up'
    END::text,
    live.catch_up_required
      OR live.serving_generation_id IS DISTINCT FROM served.id
      OR live.sync_status <> 'current',
    live.last_attempt_at, live.last_interruption_reason,
    live.last_interruption_at, live.retry_after_seconds,
    live.last_catch_up_completed_at
  FROM dna.dna_open_lab_daily_refresh_active active
  JOIN dna.dna_open_lab_daily_refresh_generation combined
    ON combined.owner_id = active.owner_id
   AND combined.refresh_cycle_id = active.refresh_cycle_id
  JOIN dna.dna_open_lab_sync_generation served
    ON served.owner_id = combined.owner_id
   AND served.id = combined.current_state_generation_id
  JOIN dna.dna_open_lab_sync_state live
    ON live.owner_id = combined.owner_id
  WHERE active.owner_id = p_owner_id;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_combined_serving_active_races(p_owner_id uuid)
RETURNS TABLE (
  generation_id uuid, source_race_id text, observed_at timestamptz,
  raw_evidence_sha256 character(64), canonical jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped combined active-race read denied';
  END IF;
  RETURN QUERY
  SELECT snapshot.generation_id, snapshot.source_race_id,
    snapshot.observed_at, snapshot.raw_evidence_sha256, snapshot.canonical
  FROM dna.dna_open_lab_daily_refresh_active active
  JOIN dna.dna_open_lab_daily_refresh_generation combined
    ON combined.owner_id = active.owner_id
   AND combined.refresh_cycle_id = active.refresh_cycle_id
  JOIN dna.dna_open_lab_active_race_snapshot snapshot
    ON snapshot.owner_id = combined.owner_id
   AND snapshot.generation_id = combined.current_state_generation_id
  WHERE active.owner_id = p_owner_id
  ORDER BY snapshot.source_race_id;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_combined_serving_race_fills(p_owner_id uuid)
RETURNS TABLE (
  generation_id uuid, source_race_id text, observed_at timestamptz,
  raw_evidence_sha256 character(64), canonical jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped combined race-fill read denied';
  END IF;
  RETURN QUERY
  SELECT snapshot.generation_id, snapshot.source_race_id,
    snapshot.observed_at, snapshot.raw_evidence_sha256, snapshot.canonical
  FROM dna.dna_open_lab_daily_refresh_active active
  JOIN dna.dna_open_lab_daily_refresh_generation combined
    ON combined.owner_id = active.owner_id
   AND combined.refresh_cycle_id = active.refresh_cycle_id
  JOIN dna.dna_open_lab_race_fill_snapshot snapshot
    ON snapshot.owner_id = combined.owner_id
   AND snapshot.generation_id = combined.current_state_generation_id
  WHERE active.owner_id = p_owner_id
  ORDER BY snapshot.source_race_id;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_combined_serving_supplemental_cores(p_owner_id uuid)
RETURNS TABLE (
  generation_id uuid, source_core_id bigint, family text,
  observed_at timestamptz, raw_evidence_sha256 character(64), canonical jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped combined supplemental Core read denied';
  END IF;
  RETURN QUERY
  SELECT snapshot.generation_id, snapshot.source_core_id, snapshot.family,
    snapshot.observed_at, snapshot.raw_evidence_sha256, snapshot.canonical
  FROM dna.dna_open_lab_daily_refresh_active active
  JOIN dna.dna_open_lab_daily_refresh_generation combined
    ON combined.owner_id = active.owner_id
   AND combined.refresh_cycle_id = active.refresh_cycle_id
  JOIN dna.dna_open_lab_core_supplemental_snapshot snapshot
    ON snapshot.owner_id = combined.owner_id
   AND snapshot.generation_id = combined.current_state_generation_id
  WHERE active.owner_id = p_owner_id
  ORDER BY snapshot.family, snapshot.source_core_id;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_combined_serving_current_state_evidence_index(
  p_owner_id uuid
)
RETURNS TABLE (
  generation_id uuid, plan_sha256 text, indexed_at timestamptz,
  receipt_count integer, receipt_index jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped combined evidence-index read denied';
  END IF;
  RETURN QUERY
  SELECT stored.generation_id, stored.plan_sha256::text, stored.indexed_at,
    stored.receipt_count, stored.receipt_index
  FROM dna.dna_open_lab_daily_refresh_active active
  JOIN dna.dna_open_lab_daily_refresh_generation combined
    ON combined.owner_id = active.owner_id
   AND combined.refresh_cycle_id = active.refresh_cycle_id
  JOIN dna.dna_open_lab_current_state_evidence_index stored
    ON stored.owner_id = combined.owner_id
   AND stored.generation_id = combined.current_state_generation_id
  WHERE active.owner_id = p_owner_id;
END
$function$;

REVOKE ALL ON FUNCTION
  dna.read_dna_open_lab_combined_serving_sync_state(uuid),
  dna.read_dna_open_lab_combined_serving_active_races(uuid),
  dna.read_dna_open_lab_combined_serving_race_fills(uuid),
  dna.read_dna_open_lab_combined_serving_supplemental_cores(uuid),
  dna.read_dna_open_lab_combined_serving_current_state_evidence_index(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  dna.read_dna_open_lab_combined_serving_sync_state(uuid),
  dna.read_dna_open_lab_combined_serving_active_races(uuid),
  dna.read_dna_open_lab_combined_serving_race_fills(uuid),
  dna.read_dna_open_lab_combined_serving_supplemental_cores(uuid),
  dna.read_dna_open_lab_combined_serving_current_state_evidence_index(uuid)
TO dna_app_runtime;

COMMIT;
