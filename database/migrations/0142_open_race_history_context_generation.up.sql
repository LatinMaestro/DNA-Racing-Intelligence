BEGIN;

CREATE TABLE dna.open_race_history_context_generation (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  context_source_identity_sha256 character(64) NOT NULL
    CHECK (context_source_identity_sha256 ~ '^[a-f0-9]{64}$'),
  worker_id text NOT NULL CHECK (
    worker_id = btrim(worker_id)
    AND worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  history_generation_version character(64) NOT NULL
    CHECK (history_generation_version ~ '^[a-f0-9]{64}$'),
  observation_set_sha256 character(64) NOT NULL
    CHECK (observation_set_sha256 ~ '^[a-f0-9]{64}$'),
  historical_aggregate_version text NOT NULL CHECK (
    octet_length(historical_aggregate_version) BETWEEN 1 AND 128
    AND historical_aggregate_version = btrim(historical_aggregate_version)
    AND historical_aggregate_version !~ '[[:cntrl:]]'
  ),
  evidence_cutoff timestamptz NOT NULL CHECK (isfinite(evidence_cutoff)),
  publication_state text NOT NULL
    CHECK (publication_state IN ('accepted', 'partial', 'unknown')),
  expected_row_count integer NOT NULL CHECK (expected_row_count BETWEEN 0 AND 500000),
  row_set_sha256 character(64) NOT NULL CHECK (row_set_sha256 ~ '^[a-f0-9]{64}$'),
  materialized_at timestamptz NOT NULL CHECK (isfinite(materialized_at)),
  manifest_json text NOT NULL CHECK (octet_length(manifest_json) BETWEEN 1 AND 524288),
  state text NOT NULL DEFAULT 'staging' CHECK (state IN ('staging', 'published')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  PRIMARY KEY (owner_id, context_source_identity_sha256),
  CHECK (context_source_identity_sha256 =
    encode(sha256(convert_to(manifest_json, 'UTF8')), 'hex')),
  CHECK (jsonb_typeof(manifest_json::jsonb) = 'object'),
  CHECK ((manifest_json::jsonb -> 'version') = '1'::jsonb),
  CHECK ((manifest_json::jsonb ->> 'historyGenerationVersion') = history_generation_version),
  CHECK ((manifest_json::jsonb ->> 'observationSetSha256') = observation_set_sha256),
  CHECK ((manifest_json::jsonb ->> 'historicalAggregateVersion') = historical_aggregate_version),
  CHECK ((manifest_json::jsonb ->> 'evidenceCutoff')::timestamptz = evidence_cutoff),
  CHECK ((manifest_json::jsonb ->> 'publicationState') = publication_state),
  CHECK ((manifest_json::jsonb ->> 'expectedRowCount')::integer = expected_row_count),
  CHECK ((manifest_json::jsonb ->> 'rowSetSha256') = row_set_sha256),
  CHECK ((manifest_json::jsonb ->> 'materializedAt')::timestamptz = materialized_at),
  CHECK ((state = 'staging' AND published_at IS NULL)
    OR (state = 'published' AND published_at IS NOT NULL))
);

CREATE TABLE dna.open_race_history_context_generation_row (
  owner_id uuid NOT NULL,
  context_source_identity_sha256 character(64) NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 499999),
  event_id text NOT NULL CHECK (
    octet_length(event_id) BETWEEN 1 AND 512
    AND event_id = btrim(event_id) AND event_id !~ '[[:cntrl:]]'
  ),
  row_sha256 character(64) NOT NULL CHECK (row_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (owner_id, context_source_identity_sha256, ordinal),
  UNIQUE (owner_id, context_source_identity_sha256, event_id),
  FOREIGN KEY (owner_id, context_source_identity_sha256)
    REFERENCES dna.open_race_history_context_generation(
      owner_id, context_source_identity_sha256) ON DELETE RESTRICT,
  CHECK (((payload ->> 'eventId') = event_id) IS TRUE),
  CHECK (((payload ->> 'competition') IN ('normal', 'esports')) IS TRUE),
  CHECK ((payload ->> 'evidenceSha256' ~ '^[a-f0-9]{64}$') IS TRUE),
  CHECK ((jsonb_typeof(payload -> 'element') = 'object') IS TRUE),
  CHECK (((payload -> 'element' ->> 'status') IN ('known', 'not_applicable', 'unknown')) IS TRUE),
  CHECK ((payload -> 'element' ->> 'status' = 'known'
      AND jsonb_typeof(payload -> 'element' -> 'value') = 'string'
      AND btrim(payload -> 'element' ->> 'value') <> '')
    OR (payload -> 'element' ->> 'status' IN ('not_applicable', 'unknown')
      AND payload -> 'element' -> 'value' = 'null'::jsonb))
);

CREATE INDEX open_race_history_context_event_read_idx
  ON dna.open_race_history_context_generation_row
    (owner_id, context_source_identity_sha256, event_id);

CREATE TABLE dna.open_race_history_context_generation_active (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  context_source_identity_sha256 character(64) NOT NULL,
  activated_at timestamptz NOT NULL CHECK (isfinite(activated_at)),
  FOREIGN KEY (owner_id, context_source_identity_sha256)
    REFERENCES dna.open_race_history_context_generation(
      owner_id, context_source_identity_sha256) ON DELETE RESTRICT
);

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'open_race_history_context_generation',
    'open_race_history_context_generation_row',
    'open_race_history_context_generation_active'
  ] LOOP
    EXECUTE format('ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('CREATE POLICY owner_isolation ON dna.%I USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id())', v_table);
  END LOOP;
END
$rls$;

CREATE FUNCTION dna.begin_open_race_history_context_generation(
  p_owner_id uuid, p_worker_id text, p_manifest_sha256 text, p_manifest_json text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_manifest jsonb; v_existing dna.open_race_history_context_generation%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN RAISE EXCEPTION 'owner-scoped historical Race context begin denied'; END IF;
  IF p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
    OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
    OR p_manifest_sha256 IS NULL OR p_manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR p_manifest_json IS NULL OR octet_length(p_manifest_json) NOT BETWEEN 1 AND 524288
    OR p_manifest_sha256 IS DISTINCT FROM encode(sha256(convert_to(p_manifest_json, 'UTF8')), 'hex')
  THEN RAISE EXCEPTION 'historical Race context manifest is invalid'; END IF;
  BEGIN v_manifest := p_manifest_json::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'historical Race context manifest is invalid'; END;
  IF jsonb_typeof(v_manifest) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(v_manifest)) <> 9
    OR NOT (v_manifest ?& ARRAY['version','historyGenerationVersion','observationSetSha256',
      'historicalAggregateVersion','evidenceCutoff','publicationState','expectedRowCount',
      'rowSetSha256','materializedAt'])
    OR (v_manifest -> 'version') IS DISTINCT FROM '1'::jsonb
    OR v_manifest ->> 'historyGenerationVersion' !~ '^[a-f0-9]{64}$'
    OR v_manifest ->> 'observationSetSha256' !~ '^[a-f0-9]{64}$'
    OR v_manifest ->> 'rowSetSha256' !~ '^[a-f0-9]{64}$'
    OR v_manifest ->> 'publicationState' NOT IN ('accepted','partial','unknown')
    OR (v_manifest ->> 'expectedRowCount')::integer NOT BETWEEN 0 AND 500000
    OR octet_length(v_manifest ->> 'historicalAggregateVersion') NOT BETWEEN 1 AND 128
    OR (v_manifest ->> 'publicationState' = 'accepted'
      AND (v_manifest ->> 'expectedRowCount')::integer = 0)
    OR (v_manifest ->> 'publicationState' = 'unknown'
      AND (v_manifest ->> 'expectedRowCount')::integer <> 0)
  THEN RAISE EXCEPTION 'historical Race context manifest is invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM dna.dna_core_race_history_generation generation
    WHERE generation.owner_id = p_owner_id
      AND generation.generation_id = v_manifest ->> 'historyGenerationVersion'
      AND generation.observation_set_sha256 = v_manifest ->> 'observationSetSha256'
      AND generation.state = 'published')
  THEN RETURN 'source_changed'; END IF;
  SELECT * INTO v_existing FROM dna.open_race_history_context_generation
    WHERE owner_id = p_owner_id AND context_source_identity_sha256 = p_manifest_sha256;
  IF FOUND THEN
    IF v_existing.manifest_json IS DISTINCT FROM p_manifest_json
      OR v_existing.worker_id IS DISTINCT FROM p_worker_id THEN RETURN 'source_changed'; END IF;
    RETURN CASE WHEN v_existing.state = 'published' THEN 'unchanged' ELSE 'staging' END;
  END IF;
  INSERT INTO dna.open_race_history_context_generation (
    owner_id, context_source_identity_sha256, worker_id,
    history_generation_version, observation_set_sha256,
    historical_aggregate_version, evidence_cutoff, publication_state,
    expected_row_count, row_set_sha256, materialized_at, manifest_json)
  VALUES (p_owner_id, p_manifest_sha256, p_worker_id,
    v_manifest ->> 'historyGenerationVersion', v_manifest ->> 'observationSetSha256',
    v_manifest ->> 'historicalAggregateVersion', (v_manifest ->> 'evidenceCutoff')::timestamptz,
    v_manifest ->> 'publicationState', (v_manifest ->> 'expectedRowCount')::integer,
    v_manifest ->> 'rowSetSha256', (v_manifest ->> 'materializedAt')::timestamptz,
    p_manifest_json);
  RETURN 'staging';
END
$function$;

CREATE FUNCTION dna.stage_open_race_history_context_rows(
  p_owner_id uuid, p_worker_id text, p_context_source_identity_sha256 text,
  p_first_ordinal integer, p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_generation dna.open_race_history_context_generation%ROWTYPE;
  v_count integer; v_inserted integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN RAISE EXCEPTION 'owner-scoped historical Race context stage denied'; END IF;
  SELECT * INTO v_generation FROM dna.open_race_history_context_generation
    WHERE owner_id = p_owner_id AND context_source_identity_sha256 = p_context_source_identity_sha256
    FOR UPDATE;
  IF NOT FOUND OR v_generation.worker_id IS DISTINCT FROM p_worker_id
    OR v_generation.state <> 'staging' THEN
    RAISE EXCEPTION 'historical Race context staging authority is invalid';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
    OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 250
    OR p_first_ordinal IS NULL OR p_first_ordinal < 0 THEN
    RAISE EXCEPTION 'historical Race context row batch is invalid';
  END IF;
  SELECT count(*)::integer INTO v_count FROM jsonb_array_elements(p_rows) item(value)
  WHERE jsonb_typeof(item.value) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(item.value)) = 4
    AND item.value ?& ARRAY['ordinal','rowSha256','canonicalPayload','payload']
    AND (item.value ->> 'ordinal')::integer BETWEEN p_first_ordinal AND p_first_ordinal + jsonb_array_length(p_rows) - 1
    AND item.value ->> 'rowSha256' ~ '^[a-f0-9]{64}$'
    AND item.value ->> 'rowSha256' = encode(sha256(convert_to(item.value ->> 'canonicalPayload','UTF8')),'hex')
    AND (item.value ->> 'canonicalPayload')::jsonb = item.value -> 'payload'
    AND jsonb_typeof(item.value -> 'payload') = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(item.value -> 'payload')) = 4
    AND item.value -> 'payload' ?& ARRAY['eventId','competition','element','evidenceSha256']
    AND jsonb_typeof(item.value -> 'payload' -> 'element') = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(item.value -> 'payload' -> 'element')) = 2
    AND item.value -> 'payload' -> 'element' ?& ARRAY['status','value'];
  IF v_count <> jsonb_array_length(p_rows)
    OR (SELECT count(DISTINCT (item.value ->> 'ordinal')::integer)
      FROM jsonb_array_elements(p_rows) item(value)) <> v_count
  THEN RAISE EXCEPTION 'historical Race context row batch is invalid'; END IF;
  INSERT INTO dna.open_race_history_context_generation_row (
    owner_id, context_source_identity_sha256, ordinal, event_id, row_sha256, payload)
  SELECT p_owner_id, p_context_source_identity_sha256, (item.value ->> 'ordinal')::integer,
    item.value -> 'payload' ->> 'eventId', item.value ->> 'rowSha256', item.value -> 'payload'
  FROM jsonb_array_elements(p_rows) item(value)
  ON CONFLICT (owner_id, context_source_identity_sha256, ordinal) DO UPDATE
    SET event_id = EXCLUDED.event_id, row_sha256 = EXCLUDED.row_sha256, payload = EXCLUDED.payload
    WHERE dna.open_race_history_context_generation_row.event_id = EXCLUDED.event_id
      AND dna.open_race_history_context_generation_row.row_sha256 = EXCLUDED.row_sha256
      AND dna.open_race_history_context_generation_row.payload = EXCLUDED.payload;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_count THEN RAISE EXCEPTION 'historical Race context replay conflict'; END IF;
  RETURN v_inserted;
END
$function$;

CREATE FUNCTION dna.publish_open_race_history_context_generation(
  p_owner_id uuid, p_worker_id text, p_context_source_identity_sha256 text,
  p_published_at timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_generation dna.open_race_history_context_generation%ROWTYPE;
  v_count integer; v_row_set_sha text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN RAISE EXCEPTION 'owner-scoped historical Race context publication denied'; END IF;
  SELECT * INTO v_generation FROM dna.open_race_history_context_generation
    WHERE owner_id = p_owner_id AND context_source_identity_sha256 = p_context_source_identity_sha256
    FOR UPDATE;
  IF NOT FOUND OR v_generation.worker_id IS DISTINCT FROM p_worker_id
  THEN RAISE EXCEPTION 'historical Race context publication authority is invalid'; END IF;
  IF v_generation.state = 'published' THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM dna.open_race_history_context_generation_active
      WHERE owner_id = p_owner_id AND context_source_identity_sha256 = p_context_source_identity_sha256)
      THEN 'unchanged' ELSE 'source_changed' END;
  END IF;
  IF p_published_at IS NULL OR NOT isfinite(p_published_at)
    OR p_published_at < v_generation.materialized_at OR p_published_at > clock_timestamp()
  THEN RAISE EXCEPTION 'historical Race context publication time is invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM dna.dna_core_race_history_generation_active active
    JOIN dna.dna_core_race_history_generation generation
      ON generation.owner_id = active.owner_id AND generation.generation_id = active.generation_id
    WHERE active.owner_id = p_owner_id
      AND active.generation_id = v_generation.history_generation_version
      AND generation.observation_set_sha256 = v_generation.observation_set_sha256
      AND generation.state = 'published')
  THEN RETURN 'source_changed'; END IF;
  SELECT count(*)::integer,
    encode(sha256(convert_to(COALESCE(string_agg(
      row.ordinal::text || ':' || row.event_id || ':' || row.row_sha256 || E'\n',
      '' ORDER BY row.ordinal), ''), 'UTF8')), 'hex')
  INTO v_count, v_row_set_sha
  FROM dna.open_race_history_context_generation_row row
  WHERE row.owner_id = p_owner_id
    AND row.context_source_identity_sha256 = p_context_source_identity_sha256;
  IF v_count <> v_generation.expected_row_count
    OR v_row_set_sha IS DISTINCT FROM v_generation.row_set_sha256
    OR EXISTS (SELECT 1 FROM dna.open_race_history_context_generation_row row
      WHERE row.owner_id = p_owner_id
        AND row.context_source_identity_sha256 = p_context_source_identity_sha256
        AND row.ordinal >= v_generation.expected_row_count)
  THEN RAISE EXCEPTION 'historical Race context generation is incomplete'; END IF;
  UPDATE dna.open_race_history_context_generation SET state = 'published', published_at = p_published_at
    WHERE owner_id = p_owner_id AND context_source_identity_sha256 = p_context_source_identity_sha256;
  INSERT INTO dna.open_race_history_context_generation_active
    (owner_id, context_source_identity_sha256, activated_at)
  VALUES (p_owner_id, p_context_source_identity_sha256, p_published_at)
  ON CONFLICT (owner_id) DO UPDATE SET
    context_source_identity_sha256 = EXCLUDED.context_source_identity_sha256,
    activated_at = EXCLUDED.activated_at;
  RETURN 'published';
END
$function$;

CREATE FUNCTION dna.read_active_open_race_history_context_pointer(p_owner_id uuid)
RETURNS TABLE (history_generation_version character(64), observation_set_sha256 character(64),
  historical_aggregate_version text, context_source_identity_sha256 character(64),
  evidence_cutoff timestamptz, publication_state text, expected_row_count integer,
  row_set_sha256 character(64), published_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN RAISE EXCEPTION 'owner-scoped historical Race context pointer read denied'; END IF;
  RETURN QUERY SELECT generation.history_generation_version, generation.observation_set_sha256,
    generation.historical_aggregate_version, generation.context_source_identity_sha256,
    generation.evidence_cutoff, generation.publication_state, generation.expected_row_count,
    generation.row_set_sha256, generation.published_at
  FROM dna.open_race_history_context_generation_active active
  JOIN dna.open_race_history_context_generation generation
    ON generation.owner_id = active.owner_id
   AND generation.context_source_identity_sha256 = active.context_source_identity_sha256
  WHERE active.owner_id = p_owner_id AND generation.state = 'published';
END
$function$;

CREATE FUNCTION dna.read_open_race_history_contexts(
  p_owner_id uuid, p_context_source_identity_sha256 text,
  p_event_ids text[], p_limit integer)
RETURNS TABLE (ordinal integer, event_id text, row_sha256 character(64), payload jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN RAISE EXCEPTION 'owner-scoped historical Race context read denied'; END IF;
  IF p_context_source_identity_sha256 IS NULL OR p_context_source_identity_sha256 !~ '^[a-f0-9]{64}$'
    OR p_event_ids IS NULL OR array_ndims(p_event_ids) IS DISTINCT FROM 1
    OR cardinality(p_event_ids) NOT BETWEEN 1 AND 10000
    OR (SELECT count(DISTINCT event_id) FROM unnest(p_event_ids) event_id) <> cardinality(p_event_ids)
    OR EXISTS (SELECT 1 FROM unnest(p_event_ids) event_id WHERE event_id IS NULL
      OR event_id <> btrim(event_id) OR octet_length(event_id) NOT BETWEEN 1 AND 512
      OR event_id ~ '[[:cntrl:]]')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10001
  THEN RAISE EXCEPTION 'historical Race context read authority is invalid'; END IF;
  RETURN QUERY SELECT row.ordinal, row.event_id, row.row_sha256, row.payload
  FROM dna.open_race_history_context_generation_active active
  JOIN dna.open_race_history_context_generation generation
    ON generation.owner_id = active.owner_id
   AND generation.context_source_identity_sha256 = active.context_source_identity_sha256
  JOIN dna.open_race_history_context_generation_row row
    ON row.owner_id = generation.owner_id
   AND row.context_source_identity_sha256 = generation.context_source_identity_sha256
  WHERE active.owner_id = p_owner_id AND generation.state = 'published'
    AND active.context_source_identity_sha256 = p_context_source_identity_sha256
    AND row.event_id = ANY(p_event_ids)
  ORDER BY row.ordinal LIMIT p_limit;
END
$function$;

REVOKE ALL ON TABLE dna.open_race_history_context_generation,
  dna.open_race_history_context_generation_row,
  dna.open_race_history_context_generation_active FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.begin_open_race_history_context_generation(uuid,text,text,text),
  dna.stage_open_race_history_context_rows(uuid,text,text,integer,jsonb),
  dna.publish_open_race_history_context_generation(uuid,text,text,timestamptz),
  dna.read_active_open_race_history_context_pointer(uuid),
  dna.read_open_race_history_contexts(uuid,text,text[],integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.begin_open_race_history_context_generation(uuid,text,text,text),
  dna.stage_open_race_history_context_rows(uuid,text,text,integer,jsonb),
  dna.publish_open_race_history_context_generation(uuid,text,text,timestamptz),
  dna.read_active_open_race_history_context_pointer(uuid),
  dna.read_open_race_history_contexts(uuid,text,text[],integer) TO dna_app_runtime;

COMMIT;
