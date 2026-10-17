BEGIN;

CREATE INDEX breeding_economic_event_evidence_idx
  ON dna.breeding_economic_record(
    owner_id,
    ((record_json::jsonb #>> '{input,breedingEventId}')),
    record_id
  )
  WHERE record_kind='evidence';

CREATE FUNCTION dna.list_breeding_economic_evidence_by_event(
  p_owner_id uuid,p_breeding_event_id text,p_limit integer
)
RETURNS TABLE(record_kind text,record_json text,fingerprint text,
  record_sha256 text,economic_version text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped breeding event evidence read denied';
  END IF;
  IF p_breeding_event_id IS NULL
    OR length(btrim(p_breeding_event_id)) NOT BETWEEN 1 AND 128
    OR p_breeding_event_id<>btrim(p_breeding_event_id)
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 128
  THEN RAISE EXCEPTION 'breeding event evidence request is invalid'; END IF;
  RETURN QUERY SELECT record.record_kind,record.record_json,
    record.fingerprint::text,record.record_sha256::text,
    COALESCE(state.economic_version,0)::text
  FROM dna.breeding_economic_record record
  LEFT JOIN dna.breeding_economic_state state ON state.owner_id=record.owner_id
  WHERE record.owner_id=p_owner_id AND record.record_kind='evidence'
    AND record.record_json::jsonb #>> '{input,breedingEventId}'
      =p_breeding_event_id
  ORDER BY record.record_id
  LIMIT (p_limit+1);
END
$function$;

REVOKE ALL ON FUNCTION dna.list_breeding_economic_evidence_by_event(uuid,text,integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.list_breeding_economic_evidence_by_event(uuid,text,integer)
  TO dna_app_runtime;

COMMIT;
