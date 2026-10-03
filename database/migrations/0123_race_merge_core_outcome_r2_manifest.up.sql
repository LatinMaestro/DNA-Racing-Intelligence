BEGIN;

CREATE TABLE dna.race_merge_core_outcome_r2_generation (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE RESTRICT,
  generation_id text NOT NULL CHECK (generation_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'),
  cohort_ordinal integer NOT NULL CHECK (cohort_ordinal > 0),
  version smallint NOT NULL CHECK (version = 1),
  first_source_core_id bigint NOT NULL CHECK (first_source_core_id > 0),
  last_source_core_id bigint NOT NULL CHECK (last_source_core_id >= first_source_core_id),
  core_count integer NOT NULL CHECK (core_count BETWEEN 1 AND 100),
  unique_outcome_count bigint NOT NULL CHECK (unique_outcome_count > 0),
  source_observation_count bigint NOT NULL CHECK (source_observation_count >= unique_outcome_count),
  retained_r2_bytes bigint NOT NULL CHECK (retained_r2_bytes BETWEEN 1 AND 67108864),
  receipt_set_sha256 character(64) NOT NULL CHECK (receipt_set_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'writing' CHECK (state IN ('writing', 'complete')),
  registered_core_count integer NOT NULL DEFAULT 0 CHECK (registered_core_count BETWEEN 0 AND 100),
  registered_unique_outcome_count bigint NOT NULL DEFAULT 0 CHECK (registered_unique_outcome_count >= 0),
  registered_source_observation_count bigint NOT NULL DEFAULT 0 CHECK (registered_source_observation_count >= 0),
  registered_r2_bytes bigint NOT NULL DEFAULT 0 CHECK (registered_r2_bytes BETWEEN 0 AND 67108864),
  last_registered_source_core_id bigint,
  completed_receipt_set_sha256 character(64) CHECK (completed_receipt_set_sha256 ~ '^[a-f0-9]{64}$'),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, generation_id, cohort_ordinal),
  CHECK (registered_core_count <= core_count),
  CHECK (registered_unique_outcome_count <= unique_outcome_count),
  CHECK (registered_source_observation_count <= source_observation_count),
  CHECK (registered_r2_bytes <= retained_r2_bytes),
  CHECK ((registered_core_count = 0 AND last_registered_source_core_id IS NULL)
    OR (registered_core_count > 0 AND last_registered_source_core_id IS NOT NULL)),
  CHECK (state <> 'complete' OR (
    registered_core_count = core_count
    AND registered_unique_outcome_count = unique_outcome_count
    AND registered_source_observation_count = source_observation_count
    AND registered_r2_bytes = retained_r2_bytes
    AND completed_receipt_set_sha256 = receipt_set_sha256
  ))
);

CREATE TABLE dna.race_merge_core_outcome_r2_manifest (
  owner_id uuid NOT NULL,
  generation_id text NOT NULL,
  cohort_ordinal integer NOT NULL,
  source_core_id bigint NOT NULL CHECK (source_core_id > 0),
  version smallint NOT NULL CHECK (version = 1),
  object_key text NOT NULL CHECK (length(object_key) BETWEEN 1 AND 2048 AND object_key !~ '[[:cntrl:]]'),
  body_sha256 character(64) NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  unique_outcome_count integer NOT NULL CHECK (unique_outcome_count BETWEEN 1 AND 50000),
  source_observation_count integer NOT NULL CHECK (source_observation_count BETWEEN unique_outcome_count AND 1200000),
  first_source_race_id text NOT NULL CHECK (length(first_source_race_id) BETWEEN 1 AND 512 AND first_source_race_id !~ '[[:cntrl:]]'),
  last_source_race_id text NOT NULL CHECK (length(last_source_race_id) BETWEEN 1 AND 512 AND last_source_race_id !~ '[[:cntrl:]]' AND last_source_race_id COLLATE "C" >= first_source_race_id COLLATE "C"),
  registered_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, generation_id, cohort_ordinal, source_core_id),
  UNIQUE (owner_id, object_key),
  FOREIGN KEY (owner_id, generation_id, cohort_ordinal)
    REFERENCES dna.race_merge_core_outcome_r2_generation(owner_id, generation_id, cohort_ordinal)
    ON DELETE RESTRICT
);

ALTER TABLE dna.race_merge_core_outcome_r2_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_merge_core_outcome_r2_generation FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.race_merge_core_outcome_r2_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_merge_core_outcome_r2_manifest FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_merge_core_outcome_r2_generation
  USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.race_merge_core_outcome_r2_manifest
  USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.reject_race_merge_core_outcome_r2_manifest_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$ BEGIN RAISE EXCEPTION 'Race Merge Core outcome R2 manifests are immutable'; END $function$;
CREATE TRIGGER immutable_race_merge_core_outcome_r2_manifest
BEFORE UPDATE OR DELETE ON dna.race_merge_core_outcome_r2_manifest
FOR EACH ROW EXECUTE FUNCTION dna.reject_race_merge_core_outcome_r2_manifest_mutation();

CREATE FUNCTION dna.begin_race_merge_core_outcome_r2_generation(
  p_owner_id uuid, p_authority jsonb, p_started_at timestamptz
) RETURNS SETOF dna.race_merge_core_outcome_r2_generation
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_existing dna.race_merge_core_outcome_r2_generation%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id()
    OR p_started_at IS NULL OR jsonb_typeof(p_authority) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_authority)) <> 10
    OR NOT (p_authority ?& ARRAY['version','generationId','cohortOrdinal','firstSourceCoreId','lastSourceCoreId','coreCount','uniqueOutcomeCount','sourceObservationCount','retainedR2Bytes','receiptSetSha256'])
    OR p_authority->>'version' !~ '^1$'
    OR p_authority->>'generationId' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$'
    OR p_authority->>'cohortOrdinal' !~ '^[1-9][0-9]*$'
    OR p_authority->>'firstSourceCoreId' !~ '^[1-9][0-9]*$'
    OR p_authority->>'lastSourceCoreId' !~ '^[1-9][0-9]*$'
    OR p_authority->>'coreCount' !~ '^[1-9][0-9]*$'
    OR p_authority->>'uniqueOutcomeCount' !~ '^[1-9][0-9]*$'
    OR p_authority->>'sourceObservationCount' !~ '^[1-9][0-9]*$'
    OR p_authority->>'retainedR2Bytes' !~ '^[1-9][0-9]*$'
    OR p_authority->>'receiptSetSha256' !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race Merge Core outcome R2 generation authority is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || (p_authority->>'generationId') || ':' || (p_authority->>'cohortOrdinal'), 0));
  SELECT * INTO v_existing FROM dna.race_merge_core_outcome_r2_generation
    WHERE owner_id=p_owner_id AND generation_id=p_authority->>'generationId' AND cohort_ordinal=(p_authority->>'cohortOrdinal')::integer FOR UPDATE;
  IF FOUND THEN
    IF to_jsonb(v_existing) - ARRAY['owner_id','state','registered_core_count','registered_unique_outcome_count','registered_source_observation_count','registered_r2_bytes','last_registered_source_core_id','completed_receipt_set_sha256','started_at','updated_at'] <>
      jsonb_build_object('generation_id',p_authority->>'generationId','cohort_ordinal',(p_authority->>'cohortOrdinal')::integer,'version',1,'first_source_core_id',(p_authority->>'firstSourceCoreId')::bigint,'last_source_core_id',(p_authority->>'lastSourceCoreId')::bigint,'core_count',(p_authority->>'coreCount')::integer,'unique_outcome_count',(p_authority->>'uniqueOutcomeCount')::bigint,'source_observation_count',(p_authority->>'sourceObservationCount')::bigint,'retained_r2_bytes',(p_authority->>'retainedR2Bytes')::bigint,'receipt_set_sha256',p_authority->>'receiptSetSha256') THEN
      RAISE EXCEPTION 'Race Merge Core outcome R2 generation replay conflicts';
    END IF;
    RETURN NEXT v_existing; RETURN;
  END IF;
  INSERT INTO dna.race_merge_core_outcome_r2_generation(owner_id,generation_id,cohort_ordinal,version,first_source_core_id,last_source_core_id,core_count,unique_outcome_count,source_observation_count,retained_r2_bytes,receipt_set_sha256,started_at,updated_at)
  VALUES(p_owner_id,p_authority->>'generationId',(p_authority->>'cohortOrdinal')::integer,1,(p_authority->>'firstSourceCoreId')::bigint,(p_authority->>'lastSourceCoreId')::bigint,(p_authority->>'coreCount')::integer,(p_authority->>'uniqueOutcomeCount')::bigint,(p_authority->>'sourceObservationCount')::bigint,(p_authority->>'retainedR2Bytes')::bigint,p_authority->>'receiptSetSha256',p_started_at,p_started_at)
  RETURNING * INTO v_existing;
  RETURN NEXT v_existing;
END $function$;

CREATE FUNCTION dna.register_race_merge_core_outcome_r2_manifest(
  p_owner_id uuid, p_generation_id text, p_cohort_ordinal integer, p_receipt jsonb, p_registered_at timestamptz
) RETURNS SETOF dna.race_merge_core_outcome_r2_generation
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_generation dna.race_merge_core_outcome_r2_generation%ROWTYPE; v_manifest dna.race_merge_core_outcome_r2_manifest%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() OR p_registered_at IS NULL OR jsonb_typeof(p_receipt)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_receipt))<>10
    OR NOT (p_receipt ?& ARRAY['version','generationId','sourceCoreId','objectKey','bodySha256','byteLength','uniqueOutcomeCount','sourceObservationCount','firstSourceRaceId','lastSourceRaceId'])
    OR p_receipt->>'version' !~ '^1$' OR p_receipt->>'generationId'<>p_generation_id
    OR p_receipt->>'sourceCoreId' !~ '^[1-9][0-9]*$' OR p_receipt->>'bodySha256' !~ '^[a-f0-9]{64}$'
    OR p_receipt->>'byteLength' !~ '^[1-9][0-9]*$' OR p_receipt->>'uniqueOutcomeCount' !~ '^[1-9][0-9]*$'
    OR p_receipt->>'sourceObservationCount' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'Race Merge Core outcome R2 receipt is invalid'; END IF;
  SELECT * INTO v_generation FROM dna.race_merge_core_outcome_r2_generation WHERE owner_id=p_owner_id AND generation_id=p_generation_id AND cohort_ordinal=p_cohort_ordinal FOR UPDATE;
  IF NOT FOUND OR v_generation.state<>'writing' THEN RAISE EXCEPTION 'Race Merge Core outcome R2 generation is not writable'; END IF;
  SELECT * INTO v_manifest FROM dna.race_merge_core_outcome_r2_manifest WHERE owner_id=p_owner_id AND generation_id=p_generation_id AND cohort_ordinal=p_cohort_ordinal AND source_core_id=(p_receipt->>'sourceCoreId')::bigint;
  IF FOUND THEN
    IF to_jsonb(v_manifest)-ARRAY['owner_id','cohort_ordinal','registered_at'] <> jsonb_build_object('generation_id',p_receipt->>'generationId','source_core_id',(p_receipt->>'sourceCoreId')::bigint,'version',1,'object_key',p_receipt->>'objectKey','body_sha256',p_receipt->>'bodySha256','byte_length',(p_receipt->>'byteLength')::integer,'unique_outcome_count',(p_receipt->>'uniqueOutcomeCount')::integer,'source_observation_count',(p_receipt->>'sourceObservationCount')::integer,'first_source_race_id',p_receipt->>'firstSourceRaceId','last_source_race_id',p_receipt->>'lastSourceRaceId') THEN RAISE EXCEPTION 'Race Merge Core outcome R2 receipt replay conflicts'; END IF;
    RETURN NEXT v_generation; RETURN;
  END IF;
  IF v_generation.registered_core_count>=v_generation.core_count OR (v_generation.last_registered_source_core_id IS NOT NULL AND (p_receipt->>'sourceCoreId')::bigint<=v_generation.last_registered_source_core_id)
    OR (p_receipt->>'sourceCoreId')::bigint NOT BETWEEN v_generation.first_source_core_id AND v_generation.last_source_core_id THEN RAISE EXCEPTION 'Race Merge Core outcome R2 receipt sequence is invalid'; END IF;
  INSERT INTO dna.race_merge_core_outcome_r2_manifest VALUES(p_owner_id,p_generation_id,p_cohort_ordinal,(p_receipt->>'sourceCoreId')::bigint,1,p_receipt->>'objectKey',p_receipt->>'bodySha256',(p_receipt->>'byteLength')::integer,(p_receipt->>'uniqueOutcomeCount')::integer,(p_receipt->>'sourceObservationCount')::integer,p_receipt->>'firstSourceRaceId',p_receipt->>'lastSourceRaceId',p_registered_at);
  UPDATE dna.race_merge_core_outcome_r2_generation SET registered_core_count=registered_core_count+1,registered_unique_outcome_count=registered_unique_outcome_count+(p_receipt->>'uniqueOutcomeCount')::integer,registered_source_observation_count=registered_source_observation_count+(p_receipt->>'sourceObservationCount')::integer,registered_r2_bytes=registered_r2_bytes+(p_receipt->>'byteLength')::integer,last_registered_source_core_id=(p_receipt->>'sourceCoreId')::bigint,updated_at=p_registered_at WHERE owner_id=p_owner_id AND generation_id=p_generation_id AND cohort_ordinal=p_cohort_ordinal RETURNING * INTO v_generation;
  RETURN NEXT v_generation;
END $function$;

CREATE FUNCTION dna.finalize_race_merge_core_outcome_r2_generation(p_owner_id uuid,p_generation_id text,p_cohort_ordinal integer,p_receipt_set_sha256 text,p_completed_at timestamptz)
RETURNS SETOF dna.race_merge_core_outcome_r2_generation LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $function$
DECLARE v_generation dna.race_merge_core_outcome_r2_generation%ROWTYPE; v_digest text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() OR p_receipt_set_sha256 !~ '^[a-f0-9]{64}$' OR p_completed_at IS NULL THEN RAISE EXCEPTION 'Race Merge Core outcome R2 finalization is invalid'; END IF;
  SELECT * INTO v_generation FROM dna.race_merge_core_outcome_r2_generation WHERE owner_id=p_owner_id AND generation_id=p_generation_id AND cohort_ordinal=p_cohort_ordinal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Race Merge Core outcome R2 generation is unavailable'; END IF;
  IF v_generation.state='complete' THEN IF v_generation.completed_receipt_set_sha256<>p_receipt_set_sha256 THEN RAISE EXCEPTION 'Race Merge Core outcome R2 finalization replay conflicts'; END IF; RETURN NEXT v_generation; RETURN; END IF;
  SELECT encode(sha256(convert_to(COALESCE(string_agg(
    octet_length(convert_to(version::text,'UTF8'))::text||':'||version::text||
    octet_length(convert_to(generation_id,'UTF8'))::text||':'||generation_id||
    octet_length(convert_to(source_core_id::text,'UTF8'))::text||':'||source_core_id::text||
    octet_length(convert_to(object_key,'UTF8'))::text||':'||object_key||
    octet_length(convert_to(body_sha256::text,'UTF8'))::text||':'||body_sha256::text||
    octet_length(convert_to(byte_length::text,'UTF8'))::text||':'||byte_length::text||
    octet_length(convert_to(unique_outcome_count::text,'UTF8'))::text||':'||unique_outcome_count::text||
    octet_length(convert_to(source_observation_count::text,'UTF8'))::text||':'||source_observation_count::text||
    octet_length(convert_to(first_source_race_id,'UTF8'))::text||':'||first_source_race_id||
    octet_length(convert_to(last_source_race_id,'UTF8'))::text||':'||last_source_race_id||E'\n','' ORDER BY source_core_id),''),'UTF8')),'hex') INTO v_digest
  FROM dna.race_merge_core_outcome_r2_manifest WHERE owner_id=p_owner_id AND generation_id=p_generation_id AND cohort_ordinal=p_cohort_ordinal;
  IF v_generation.registered_core_count<>v_generation.core_count OR v_generation.registered_unique_outcome_count<>v_generation.unique_outcome_count OR v_generation.registered_source_observation_count<>v_generation.source_observation_count OR v_generation.registered_r2_bytes<>v_generation.retained_r2_bytes OR v_generation.last_registered_source_core_id<>v_generation.last_source_core_id OR v_digest<>v_generation.receipt_set_sha256::text OR v_digest<>p_receipt_set_sha256 THEN RAISE EXCEPTION 'Race Merge Core outcome R2 generation is incomplete or drifted'; END IF;
  UPDATE dna.race_merge_core_outcome_r2_generation SET state='complete',completed_receipt_set_sha256=p_receipt_set_sha256,updated_at=p_completed_at WHERE owner_id=p_owner_id AND generation_id=p_generation_id AND cohort_ordinal=p_cohort_ordinal RETURNING * INTO v_generation;
  RETURN NEXT v_generation;
END $function$;

CREATE FUNCTION dna.read_race_merge_core_outcome_r2_manifests(p_owner_id uuid,p_generation_id text,p_cohort_ordinal integer,p_after_source_core_id bigint,p_limit integer)
RETURNS SETOF dna.race_merge_core_outcome_r2_manifest LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,pg_temp AS $function$
BEGIN IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() OR p_after_source_core_id<0 OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Race Merge Core outcome R2 manifest read is invalid'; END IF;
RETURN QUERY SELECT * FROM dna.race_merge_core_outcome_r2_manifest m WHERE m.owner_id=p_owner_id AND m.generation_id=p_generation_id AND m.cohort_ordinal=p_cohort_ordinal AND m.source_core_id>p_after_source_core_id ORDER BY m.source_core_id LIMIT p_limit; END $function$;

REVOKE ALL ON dna.race_merge_core_outcome_r2_generation,dna.race_merge_core_outcome_r2_manifest FROM PUBLIC,dna_app_runtime;
REVOKE ALL ON FUNCTION dna.reject_race_merge_core_outcome_r2_manifest_mutation() FROM PUBLIC,dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.begin_race_merge_core_outcome_r2_generation(uuid,jsonb,timestamptz),dna.register_race_merge_core_outcome_r2_manifest(uuid,text,integer,jsonb,timestamptz),dna.finalize_race_merge_core_outcome_r2_generation(uuid,text,integer,text,timestamptz),dna.read_race_merge_core_outcome_r2_manifests(uuid,text,integer,bigint,integer) TO dna_app_runtime;

COMMIT;
