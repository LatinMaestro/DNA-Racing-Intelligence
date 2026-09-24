BEGIN;

CREATE TABLE dna.dna_population_race_index_generation (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  generation_id character(64) NOT NULL CHECK (generation_id ~ '^[a-f0-9]{64}$'),
  version smallint NOT NULL CHECK (version = 1),
  worker_id text NOT NULL CHECK (
    worker_id = btrim(worker_id)
    AND worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
  ),
  baseline_completion_sha256 character(64) NOT NULL
    CHECK (baseline_completion_sha256 ~ '^[a-f0-9]{64}$'),
  baseline_logical_request_count integer NOT NULL
    CHECK (baseline_logical_request_count BETWEEN 1 AND 1000000),
  baseline_retained_r2_bytes bigint NOT NULL CHECK (baseline_retained_r2_bytes > 0),
  baseline_omitted_identity_observation_count integer NOT NULL
    CHECK (baseline_omitted_identity_observation_count BETWEEN 0 AND 1000000),
  state text NOT NULL DEFAULT 'staging'
    CHECK (state IN ('staging', 'complete', 'published')),
  last_request_ordinal integer NOT NULL DEFAULT 0 CHECK (last_request_ordinal >= 0),
  processed_receipt_count integer NOT NULL DEFAULT 0 CHECK (processed_receipt_count >= 0),
  processed_receipt_bytes bigint NOT NULL DEFAULT 0 CHECK (processed_receipt_bytes >= 0),
  processed_identity_omission_count integer NOT NULL DEFAULT 0
    CHECK (processed_identity_omission_count >= 0),
  finished_race_receipt_count integer NOT NULL DEFAULT 0
    CHECK (finished_race_receipt_count >= 0),
  canonical_document_observation_count bigint NOT NULL DEFAULT 0
    CHECK (canonical_document_observation_count >= 0),
  unique_race_count integer NOT NULL DEFAULT 0 CHECK (unique_race_count >= 0),
  unique_entrant_core_count integer NOT NULL DEFAULT 0
    CHECK (unique_entrant_core_count >= 0),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  published_at timestamptz,
  PRIMARY KEY (owner_id, generation_id),
  CHECK (generation_id = baseline_completion_sha256),
  CHECK (last_request_ordinal <= baseline_logical_request_count),
  CHECK (processed_receipt_count = last_request_ordinal),
  CHECK (processed_receipt_bytes <= baseline_retained_r2_bytes),
  CHECK (
    processed_identity_omission_count <= baseline_omitted_identity_observation_count
  ),
  CHECK (
    (state = 'staging' AND completed_at IS NULL AND published_at IS NULL)
    OR (state = 'complete' AND completed_at IS NOT NULL AND published_at IS NULL)
    OR (state = 'published' AND completed_at IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE TABLE dna.dna_population_race_index_batch_receipt (
  owner_id uuid NOT NULL,
  generation_id character(64) NOT NULL,
  after_request_ordinal integer NOT NULL CHECK (after_request_ordinal >= 0),
  next_request_ordinal integer NOT NULL CHECK (next_request_ordinal > 0),
  batch_sha256 character(64) NOT NULL CHECK (batch_sha256 ~ '^[a-f0-9]{64}$'),
  processed_receipt_count integer NOT NULL CHECK (processed_receipt_count BETWEEN 1 AND 100),
  processed_receipt_bytes bigint NOT NULL CHECK (processed_receipt_bytes > 0),
  processed_identity_omission_count integer NOT NULL
    CHECK (processed_identity_omission_count BETWEEN 0 AND 1000000),
  finished_race_receipt_count integer NOT NULL
    CHECK (finished_race_receipt_count BETWEEN 0 AND 100),
  canonical_document_observation_count integer NOT NULL
    CHECK (canonical_document_observation_count BETWEEN 0 AND 5000),
  completes_generation boolean NOT NULL,
  written_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, generation_id, after_request_ordinal),
  UNIQUE (owner_id, generation_id, batch_sha256),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_population_race_index_generation(owner_id, generation_id)
    ON DELETE RESTRICT,
  CHECK (next_request_ordinal = after_request_ordinal + processed_receipt_count + 1)
);

CREATE TABLE dna.dna_population_race_index_race (
  owner_id uuid NOT NULL,
  generation_id character(64) NOT NULL,
  source_race_id text NOT NULL CHECK (
    length(source_race_id) BETWEEN 1 AND 512 AND source_race_id !~ '[[:cntrl:]]'
  ),
  request_ordinal integer NOT NULL CHECK (request_ordinal > 0),
  endpoint text NOT NULL CHECK (endpoint IN ('races.finished', 'races.docs')),
  observed_at timestamptz NOT NULL,
  raw_evidence_sha256 character(64) NOT NULL CHECK (raw_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  mode text CHECK (mode IN ('bike', 'car', 'horse')),
  canonical jsonb NOT NULL CHECK (
    jsonb_typeof(canonical) = 'object'
    AND canonical ->> 'sourceType' = 'race_document'
  ),
  PRIMARY KEY (owner_id, generation_id, source_race_id),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_population_race_index_generation(owner_id, generation_id)
    ON DELETE RESTRICT
);

CREATE TABLE dna.dna_population_race_index_entrant (
  owner_id uuid NOT NULL,
  generation_id character(64) NOT NULL,
  source_race_id text NOT NULL,
  source_core_id text NOT NULL CHECK (
    length(source_core_id) BETWEEN 1 AND 512 AND source_core_id !~ '[[:cntrl:]]'
  ),
  mode text CHECK (mode IN ('bike', 'car', 'horse')),
  PRIMARY KEY (owner_id, generation_id, source_race_id, source_core_id),
  FOREIGN KEY (owner_id, generation_id, source_race_id)
    REFERENCES dna.dna_population_race_index_race(owner_id, generation_id, source_race_id)
    ON DELETE CASCADE
);

CREATE INDEX dna_population_race_index_race_mode_idx
  ON dna.dna_population_race_index_race(owner_id, generation_id, mode, source_race_id);
CREATE INDEX dna_population_race_index_entrant_core_idx
  ON dna.dna_population_race_index_entrant(owner_id, generation_id, source_core_id, mode);

CREATE TABLE dna.dna_population_race_index_active (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  generation_id character(64) NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_population_race_index_generation(owner_id, generation_id)
    ON DELETE RESTRICT
);

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'dna_population_race_index_generation',
    'dna_population_race_index_batch_receipt',
    'dna_population_race_index_race',
    'dna_population_race_index_entrant',
    'dna_population_race_index_active'
  ] LOOP
    EXECUTE format('ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY owner_isolation ON dna.%I USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id())',
      v_table
    );
  END LOOP;
END
$rls$;

CREATE FUNCTION dna.begin_dna_population_race_index_generation(
  p_owner_id uuid,
  p_worker_id text,
  p_authority jsonb,
  p_started_at timestamptz
)
RETURNS SETOF dna.dna_population_race_index_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation_id character(64);
  v_existing dna.dna_population_race_index_generation%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped population race index begin denied';
  END IF;
  IF p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_authority IS NULL OR jsonb_typeof(p_authority) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_authority)) <> 6
     OR NOT (p_authority ?& ARRAY[
       'version', 'generationId', 'baselineCompletionSha256',
       'baselineLogicalRequestCount', 'baselineRetainedR2Bytes',
       'baselineOmittedIdentityObservationCount'
     ])
     OR p_authority ->> 'version' <> '1'
     OR p_authority ->> 'generationId' !~ '^[a-f0-9]{64}$'
     OR p_authority ->> 'baselineCompletionSha256' !~ '^[a-f0-9]{64}$'
     OR p_authority ->> 'generationId' <> p_authority ->> 'baselineCompletionSha256'
     OR p_authority ->> 'baselineLogicalRequestCount' !~ '^[0-9]+$'
     OR (p_authority ->> 'baselineLogicalRequestCount')::numeric NOT BETWEEN 1 AND 1000000
     OR p_authority ->> 'baselineRetainedR2Bytes' !~ '^[0-9]+$'
     OR (p_authority ->> 'baselineRetainedR2Bytes')::numeric < 1
     OR p_authority ->> 'baselineOmittedIdentityObservationCount' !~ '^[0-9]+$'
     OR (p_authority ->> 'baselineOmittedIdentityObservationCount')::numeric > 1000000
     OR p_started_at IS NULL OR p_started_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population race index begin authority is invalid';
  END IF;
  v_generation_id := (p_authority ->> 'generationId')::character(64);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-race-index:' || v_generation_id::text, 0
  ));
  SELECT stored.* INTO v_existing
  FROM dna.dna_population_race_index_generation stored
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = v_generation_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.worker_id <> p_worker_id
       OR v_existing.baseline_completion_sha256::text <> p_authority ->> 'baselineCompletionSha256'
       OR v_existing.baseline_logical_request_count <> (p_authority ->> 'baselineLogicalRequestCount')::integer
       OR v_existing.baseline_retained_r2_bytes <> (p_authority ->> 'baselineRetainedR2Bytes')::bigint
       OR v_existing.baseline_omitted_identity_observation_count <>
          (p_authority ->> 'baselineOmittedIdentityObservationCount')::integer THEN
      RAISE EXCEPTION 'population race index begin replay conflicts';
    END IF;
    RETURN NEXT v_existing;
    RETURN;
  END IF;
  INSERT INTO dna.dna_population_race_index_generation (
    owner_id, generation_id, version, worker_id, baseline_completion_sha256,
    baseline_logical_request_count, baseline_retained_r2_bytes,
    baseline_omitted_identity_observation_count, started_at, updated_at
  ) VALUES (
    p_owner_id, v_generation_id, 1, p_worker_id,
    (p_authority ->> 'baselineCompletionSha256')::character(64),
    (p_authority ->> 'baselineLogicalRequestCount')::integer,
    (p_authority ->> 'baselineRetainedR2Bytes')::bigint,
    (p_authority ->> 'baselineOmittedIdentityObservationCount')::integer,
    p_started_at, p_started_at
  ) RETURNING * INTO v_existing;
  RETURN NEXT v_existing;
END
$function$;

CREATE FUNCTION dna.append_dna_population_race_index_batch(
  p_owner_id uuid,
  p_worker_id text,
  p_batch jsonb,
  p_written_at timestamptz
)
RETURNS SETOF dna.dna_population_race_index_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_race_index_generation%ROWTYPE;
  v_existing_batch dna.dna_population_race_index_batch_receipt%ROWTYPE;
  v_existing_race dna.dna_population_race_index_race%ROWTYPE;
  v_generation_id character(64);
  v_after integer;
  v_next integer;
  v_receipts integer;
  v_bytes bigint;
  v_omissions integer;
  v_finished integer;
  v_documents integer;
  v_complete boolean;
  v_document jsonb;
  v_request_ordinal integer;
  v_race_id text;
  v_endpoint text;
  v_observed_at timestamptz;
  v_raw_sha text;
  v_mode text;
  v_canonical jsonb;
  v_entrants jsonb;
  v_core_id text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped population race index append denied';
  END IF;
  IF p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_batch IS NULL OR jsonb_typeof(p_batch) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_batch)) <> 12
     OR NOT (p_batch ?& ARRAY[
       'version', 'generationId', 'batchSha256', 'afterRequestOrdinal',
       'nextRequestOrdinal', 'processedReceiptCount', 'processedReceiptBytes',
       'processedIdentityOmissionCount', 'finishedRaceReceiptCount',
       'canonicalDocumentObservationCount', 'documents', 'complete'
     ])
     OR p_batch ->> 'version' <> '1'
     OR p_batch ->> 'generationId' !~ '^[a-f0-9]{64}$'
     OR p_batch ->> 'batchSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_batch -> 'documents') <> 'array'
     OR jsonb_typeof(p_batch -> 'complete') <> 'boolean'
     OR p_written_at IS NULL OR p_written_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population race index append request is invalid';
  END IF;
  BEGIN
    v_after := (p_batch ->> 'afterRequestOrdinal')::integer;
    v_next := (p_batch ->> 'nextRequestOrdinal')::integer;
    v_receipts := (p_batch ->> 'processedReceiptCount')::integer;
    v_bytes := (p_batch ->> 'processedReceiptBytes')::bigint;
    v_omissions := (p_batch ->> 'processedIdentityOmissionCount')::integer;
    v_finished := (p_batch ->> 'finishedRaceReceiptCount')::integer;
    v_documents := (p_batch ->> 'canonicalDocumentObservationCount')::integer;
    v_complete := (p_batch ->> 'complete')::boolean;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'population race index append counters are invalid';
  END;
  IF v_after < 0 OR v_receipts NOT BETWEEN 1 AND 100
     OR v_next <> v_after + v_receipts + 1 OR v_bytes < 1
     OR v_omissions < 0 OR v_finished NOT BETWEEN 0 AND v_receipts
     OR v_documents NOT BETWEEN 0 AND 5000
     OR jsonb_array_length(p_batch -> 'documents') <> v_documents THEN
    RAISE EXCEPTION 'population race index append bounds are invalid';
  END IF;
  v_generation_id := (p_batch ->> 'generationId')::character(64);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-race-index:' || v_generation_id::text, 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.dna_population_race_index_generation stored
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = v_generation_id
  FOR UPDATE;
  IF NOT FOUND OR v_generation.worker_id <> p_worker_id THEN
    RAISE EXCEPTION 'population race index staging claim is unavailable';
  END IF;
  SELECT stored.* INTO v_existing_batch
  FROM dna.dna_population_race_index_batch_receipt stored
  WHERE stored.owner_id = p_owner_id AND stored.generation_id = v_generation_id
    AND stored.after_request_ordinal = v_after
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_batch.batch_sha256::text <> p_batch ->> 'batchSha256'
       OR v_existing_batch.next_request_ordinal <> v_next
       OR v_existing_batch.processed_receipt_count <> v_receipts
       OR v_existing_batch.processed_receipt_bytes <> v_bytes
       OR v_existing_batch.processed_identity_omission_count <> v_omissions
       OR v_existing_batch.finished_race_receipt_count <> v_finished
       OR v_existing_batch.canonical_document_observation_count <> v_documents
       OR v_existing_batch.completes_generation <> v_complete THEN
      RAISE EXCEPTION 'population race index batch replay conflicts';
    END IF;
    RETURN NEXT v_generation;
    RETURN;
  END IF;
  IF v_generation.state <> 'staging' OR v_generation.last_request_ordinal <> v_after
     OR v_generation.processed_receipt_count + v_receipts > v_generation.baseline_logical_request_count
     OR v_generation.processed_receipt_bytes + v_bytes > v_generation.baseline_retained_r2_bytes
     OR v_generation.processed_identity_omission_count + v_omissions >
        v_generation.baseline_omitted_identity_observation_count
     OR v_complete <> (v_next = v_generation.baseline_logical_request_count + 1) THEN
    RAISE EXCEPTION 'population race index checkpoint transition is invalid';
  END IF;

  FOR v_document IN SELECT value FROM jsonb_array_elements(p_batch -> 'documents')
  LOOP
    IF jsonb_typeof(v_document) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_document)) <> 6
       OR NOT (v_document ?& ARRAY[
         'requestOrdinal', 'endpoint', 'observedAt', 'sourceRaceId',
         'rawEvidenceSha256', 'canonical'
       ]) THEN
      RAISE EXCEPTION 'population race index document fields are invalid';
    END IF;
    BEGIN
      v_request_ordinal := (v_document ->> 'requestOrdinal')::integer;
      v_observed_at := (v_document ->> 'observedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'population race index document values are invalid';
    END;
    v_endpoint := v_document ->> 'endpoint';
    v_race_id := v_document ->> 'sourceRaceId';
    v_raw_sha := v_document ->> 'rawEvidenceSha256';
    v_canonical := v_document -> 'canonical';
    v_mode := v_canonical ->> 'mode';
    v_entrants := v_canonical -> 'entrantCoreIds';
    IF v_request_ordinal <= v_after OR v_request_ordinal >= v_next
       OR v_endpoint NOT IN ('races.finished', 'races.docs')
       OR length(v_race_id) NOT BETWEEN 1 AND 512 OR v_race_id ~ '[[:cntrl:]]'
       OR v_raw_sha !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(v_canonical) <> 'object'
       OR v_canonical ->> 'sourceType' <> 'race_document'
       OR v_canonical ->> 'sourceRaceId' IS DISTINCT FROM v_race_id
       OR (v_mode IS NOT NULL AND v_mode NOT IN ('bike', 'car', 'horse'))
       OR (v_entrants IS NOT NULL AND jsonb_typeof(v_entrants) <> 'array')
       OR (
         v_entrants IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements(v_entrants) entrant(value)
           WHERE jsonb_typeof(entrant.value) <> 'string'
         )
       ) THEN
      RAISE EXCEPTION 'population race index document authority is invalid';
    END IF;
    SELECT stored.* INTO v_existing_race
    FROM dna.dna_population_race_index_race stored
    WHERE stored.owner_id = p_owner_id AND stored.generation_id = v_generation_id
      AND stored.source_race_id = v_race_id
    FOR UPDATE;
    IF FOUND AND v_existing_race.request_ordinal = v_request_ordinal THEN
      IF v_existing_race.endpoint <> v_endpoint
         OR v_existing_race.observed_at <> v_observed_at
         OR v_existing_race.raw_evidence_sha256::text <> v_raw_sha
         OR v_existing_race.canonical <> v_canonical THEN
        RAISE EXCEPTION 'population race index document replay conflicts';
      END IF;
      CONTINUE;
    END IF;
    IF FOUND AND v_existing_race.request_ordinal > v_request_ordinal THEN
      CONTINUE;
    END IF;
    IF FOUND AND v_existing_race.mode IS NOT NULL AND v_mode IS NOT NULL
       AND v_existing_race.mode <> v_mode THEN
      RAISE EXCEPTION 'population race index mode identity drifted';
    END IF;
    INSERT INTO dna.dna_population_race_index_race (
      owner_id, generation_id, source_race_id, request_ordinal, endpoint,
      observed_at, raw_evidence_sha256, mode, canonical
    ) VALUES (
      p_owner_id, v_generation_id, v_race_id, v_request_ordinal, v_endpoint,
      v_observed_at, v_raw_sha::character(64), v_mode, v_canonical
    ) ON CONFLICT (owner_id, generation_id, source_race_id) DO UPDATE SET
      request_ordinal = EXCLUDED.request_ordinal,
      endpoint = EXCLUDED.endpoint,
      observed_at = EXCLUDED.observed_at,
      raw_evidence_sha256 = EXCLUDED.raw_evidence_sha256,
      mode = EXCLUDED.mode,
      canonical = EXCLUDED.canonical;
    DELETE FROM dna.dna_population_race_index_entrant entrant
    WHERE entrant.owner_id = p_owner_id AND entrant.generation_id = v_generation_id
      AND entrant.source_race_id = v_race_id;
    IF v_entrants IS NOT NULL THEN
      FOR v_core_id IN SELECT jsonb_array_elements_text(v_entrants)
      LOOP
        IF length(v_core_id) NOT BETWEEN 1 AND 512 OR v_core_id ~ '[[:cntrl:]]' THEN
          RAISE EXCEPTION 'population race index entrant identity is invalid';
        END IF;
        INSERT INTO dna.dna_population_race_index_entrant (
          owner_id, generation_id, source_race_id, source_core_id, mode
        ) VALUES (p_owner_id, v_generation_id, v_race_id, v_core_id, v_mode)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO dna.dna_population_race_index_batch_receipt (
    owner_id, generation_id, after_request_ordinal, next_request_ordinal,
    batch_sha256, processed_receipt_count, processed_receipt_bytes,
    processed_identity_omission_count, finished_race_receipt_count,
    canonical_document_observation_count, completes_generation, written_at
  ) VALUES (
    p_owner_id, v_generation_id, v_after, v_next,
    (p_batch ->> 'batchSha256')::character(64), v_receipts, v_bytes,
    v_omissions, v_finished, v_documents, v_complete, p_written_at
  );
  UPDATE dna.dna_population_race_index_generation generation SET
    last_request_ordinal = v_next - 1,
    processed_receipt_count = generation.processed_receipt_count + v_receipts,
    processed_receipt_bytes = generation.processed_receipt_bytes + v_bytes,
    processed_identity_omission_count =
      generation.processed_identity_omission_count + v_omissions,
    finished_race_receipt_count = generation.finished_race_receipt_count + v_finished,
    canonical_document_observation_count =
      generation.canonical_document_observation_count + v_documents,
    unique_race_count = (
      SELECT count(*) FROM dna.dna_population_race_index_race race
      WHERE race.owner_id = p_owner_id AND race.generation_id = v_generation_id
    ),
    unique_entrant_core_count = (
      SELECT count(DISTINCT entrant.source_core_id)
      FROM dna.dna_population_race_index_entrant entrant
      WHERE entrant.owner_id = p_owner_id AND entrant.generation_id = v_generation_id
    ),
    state = CASE WHEN v_complete THEN 'complete' ELSE 'staging' END,
    updated_at = p_written_at,
    completed_at = CASE WHEN v_complete THEN p_written_at ELSE NULL END
  WHERE generation.owner_id = p_owner_id AND generation.generation_id = v_generation_id
  RETURNING * INTO v_generation;
  IF v_complete AND (
    v_generation.processed_receipt_count <> v_generation.baseline_logical_request_count
    OR v_generation.processed_receipt_bytes <> v_generation.baseline_retained_r2_bytes
    OR v_generation.processed_identity_omission_count <>
       v_generation.baseline_omitted_identity_observation_count
  ) THEN
    RAISE EXCEPTION 'population race index completion totals disagree';
  END IF;
  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.publish_dna_population_race_index_generation(
  p_owner_id uuid,
  p_worker_id text,
  p_generation_id text,
  p_published_at timestamptz
)
RETURNS SETOF dna.dna_population_race_index_generation
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_generation dna.dna_population_race_index_generation%ROWTYPE;
  v_active dna.dna_population_race_index_active%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped population race index publication denied';
  END IF;
  IF p_worker_id IS NULL OR p_worker_id <> btrim(p_worker_id)
     OR p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$'
     OR p_published_at IS NULL OR p_published_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'population race index publication request is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_id::text || ':population-race-index-publication', 0
  ));
  SELECT stored.* INTO v_generation
  FROM dna.dna_population_race_index_generation stored
  WHERE stored.owner_id = p_owner_id
    AND stored.generation_id = p_generation_id::character(64)
  FOR UPDATE;
  IF NOT FOUND OR v_generation.worker_id <> p_worker_id
     OR v_generation.state NOT IN ('complete', 'published')
     OR v_generation.last_request_ordinal <> v_generation.baseline_logical_request_count
     OR v_generation.processed_receipt_count <> v_generation.baseline_logical_request_count
     OR v_generation.processed_receipt_bytes <> v_generation.baseline_retained_r2_bytes
     OR v_generation.processed_identity_omission_count <>
        v_generation.baseline_omitted_identity_observation_count THEN
    RAISE EXCEPTION 'population race index completion authority is unavailable';
  END IF;
  IF v_generation.state = 'published' THEN
    IF v_generation.published_at <> p_published_at THEN
      RAISE EXCEPTION 'population race index publication replay conflicts';
    END IF;
    RETURN NEXT v_generation;
    RETURN;
  END IF;
  SELECT active.* INTO v_active
  FROM dna.dna_population_race_index_active active
  WHERE active.owner_id = p_owner_id
  FOR UPDATE;
  IF FOUND AND v_active.generation_id <> v_generation.generation_id THEN
    RAISE EXCEPTION 'population race index successor lineage is not authorized';
  END IF;
  UPDATE dna.dna_population_race_index_generation generation SET
    state = 'published', published_at = p_published_at, updated_at = p_published_at
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64)
  RETURNING * INTO v_generation;
  INSERT INTO dna.dna_population_race_index_active(owner_id, generation_id, activated_at)
  VALUES (p_owner_id, v_generation.generation_id, p_published_at)
  ON CONFLICT (owner_id) DO UPDATE SET
    generation_id = EXCLUDED.generation_id, activated_at = EXCLUDED.activated_at;
  RETURN NEXT v_generation;
END
$function$;

CREATE FUNCTION dna.read_dna_population_race_index_generation(
  p_owner_id uuid,
  p_generation_id text
)
RETURNS SETOF dna.dna_population_race_index_generation
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
     OR p_generation_id IS NULL OR p_generation_id !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'owner-scoped population race index read denied';
  END IF;
  RETURN QUERY SELECT generation.*
  FROM dna.dna_population_race_index_generation generation
  WHERE generation.owner_id = p_owner_id
    AND generation.generation_id = p_generation_id::character(64);
END
$function$;

REVOKE ALL ON TABLE
  dna.dna_population_race_index_generation,
  dna.dna_population_race_index_batch_receipt,
  dna.dna_population_race_index_race,
  dna.dna_population_race_index_entrant,
  dna.dna_population_race_index_active
FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION
  dna.begin_dna_population_race_index_generation(uuid,text,jsonb,timestamp with time zone),
  dna.append_dna_population_race_index_batch(uuid,text,jsonb,timestamp with time zone),
  dna.publish_dna_population_race_index_generation(uuid,text,text,timestamp with time zone),
  dna.read_dna_population_race_index_generation(uuid,text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  dna.begin_dna_population_race_index_generation(uuid,text,jsonb,timestamp with time zone),
  dna.append_dna_population_race_index_batch(uuid,text,jsonb,timestamp with time zone),
  dna.publish_dna_population_race_index_generation(uuid,text,text,timestamp with time zone),
  dna.read_dna_population_race_index_generation(uuid,text)
TO dna_app_runtime;

COMMIT;
