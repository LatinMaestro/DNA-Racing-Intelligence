BEGIN;

CREATE TABLE dna.breeding_economic_state (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  economic_version bigint NOT NULL DEFAULT 0 CHECK (economic_version >= 0)
);

CREATE TABLE dna.breeding_economic_record (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  record_id text NOT NULL CHECK (
    length(record_id) BETWEEN 8 AND 128 AND
    record_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]+$'
  ),
  record_kind text NOT NULL CHECK (record_kind IN ('evidence','cost_basis')),
  fingerprint character(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  record_sha256 character(64) NOT NULL CHECK (record_sha256 ~ '^[a-f0-9]{64}$'),
  record_json text NOT NULL CHECK (
    octet_length(record_json) BETWEEN 2 AND 524288 AND
    jsonb_typeof(record_json::jsonb) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id,record_id),
  CHECK (record_sha256 = encode(sha256(convert_to(record_json,'UTF8')),'hex'))
);

CREATE TABLE dna.breeding_cost_basis_transaction (
  owner_id uuid NOT NULL,
  transaction_id text NOT NULL CHECK (
    length(transaction_id) BETWEEN 1 AND 128 AND
    transaction_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]*$'
  ),
  assignment_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id,transaction_id),
  FOREIGN KEY (owner_id,assignment_id)
    REFERENCES dna.breeding_economic_record(owner_id,record_id)
    ON DELETE RESTRICT
);

CREATE INDEX breeding_cost_basis_assignment_idx
  ON dna.breeding_cost_basis_transaction(owner_id,assignment_id,transaction_id);

ALTER TABLE dna.breeding_economic_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.breeding_economic_state FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.breeding_economic_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.breeding_economic_record FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.breeding_cost_basis_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.breeding_cost_basis_transaction FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.breeding_economic_state
  USING (owner_id=dna.current_owner_id())
  WITH CHECK (owner_id=dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.breeding_economic_record
  USING (owner_id=dna.current_owner_id())
  WITH CHECK (owner_id=dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.breeding_cost_basis_transaction
  USING (owner_id=dna.current_owner_id())
  WITH CHECK (owner_id=dna.current_owner_id());

CREATE FUNCTION dna.read_breeding_economic_write_context(p_owner_id uuid)
RETURNS TABLE(asset_registry_version text,assets_json text,economic_version text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE v_assets jsonb;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped breeding economic context denied';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'code',upper(asset.code),
    'kind',CASE asset.asset_kind WHEN 'bgc' THEN 'game_credit'
      WHEN 'fiat' THEN 'fiat' ELSE 'crypto' END,
    'precision',asset.atomic_scale
  ) ORDER BY upper(asset.code)) INTO v_assets
  FROM dna.asset_currency asset WHERE asset.owner_id=p_owner_id;
  IF v_assets IS NULL OR jsonb_array_length(v_assets)=0 THEN RETURN; END IF;
  RETURN QUERY SELECT
    encode(sha256(convert_to(v_assets::text,'UTF8')),'hex'),v_assets::text,
    COALESCE((SELECT state.economic_version::text
      FROM dna.breeding_economic_state state WHERE state.owner_id=p_owner_id),'0');
END
$function$;

CREATE FUNCTION dna.read_breeding_economic_record(
  p_owner_id uuid,p_record_id text
)
RETURNS TABLE(record_kind text,record_json text,fingerprint text,
  record_sha256 text,economic_version text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped breeding economic record read denied';
  END IF;
  RETURN QUERY SELECT record.record_kind,record.record_json,
    record.fingerprint::text,record.record_sha256::text,
    COALESCE(state.economic_version,0)::text
  FROM dna.breeding_economic_record record
  LEFT JOIN dna.breeding_economic_state state ON state.owner_id=record.owner_id
  WHERE record.owner_id=p_owner_id AND record.record_id=p_record_id
  LIMIT 1;
END
$function$;

CREATE FUNCTION dna.list_assigned_breeding_cost_transactions(
  p_owner_id uuid,p_transaction_ids text[]
)
RETURNS TABLE(transaction_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped breeding transaction read denied';
  END IF;
  IF p_transaction_ids IS NULL OR cardinality(p_transaction_ids)>128 THEN
    RAISE EXCEPTION 'breeding transaction request exceeds bound';
  END IF;
  RETURN QUERY SELECT assigned.transaction_id
  FROM dna.breeding_cost_basis_transaction assigned
  WHERE assigned.owner_id=p_owner_id
    AND assigned.transaction_id=ANY(p_transaction_ids)
  ORDER BY assigned.transaction_id LIMIT 129;
END
$function$;

CREATE FUNCTION dna.write_breeding_economic_record(
  p_owner_id uuid,p_record_kind text,p_record_id text,
  p_fingerprint character(64),p_record_sha256 character(64),p_record_json text,
  p_expected_economic_version text,p_transaction_ids text[]
)
RETURNS TABLE(disposition text,fingerprint text,economic_version text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  v_record jsonb;
  v_existing character(64);
  v_version bigint;
  v_json_transaction_ids text[];
  v_transaction_ids text[];
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped breeding economic write denied';
  END IF;
  IF p_record_kind NOT IN ('evidence','cost_basis')
    OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_record_sha256 IS NULL OR p_record_sha256 !~ '^[a-f0-9]{64}$'
    OR encode(sha256(convert_to(p_record_json,'UTF8')),'hex')<>p_record_sha256
    OR p_transaction_ids IS NULL OR cardinality(p_transaction_ids)>128
  THEN RAISE EXCEPTION 'breeding economic candidate is invalid'; END IF;
  v_record:=p_record_json::jsonb;
  IF jsonb_typeof(v_record)<>'object' THEN
    RAISE EXCEPTION 'breeding economic record is invalid';
  END IF;
  SELECT COALESCE(array_agg(value ORDER BY value),ARRAY[]::text[])
  INTO v_transaction_ids
  FROM (SELECT DISTINCT btrim(value) AS value FROM unnest(p_transaction_ids) value) ids;
  IF cardinality(v_transaction_ids)<>cardinality(p_transaction_ids)
    OR EXISTS(SELECT 1 FROM unnest(v_transaction_ids) value
      WHERE value='' OR length(value)>128
        OR value !~ '^[A-Za-z0-9][A-Za-z0-9:._-]*$')
  THEN RAISE EXCEPTION 'breeding transaction identities are invalid'; END IF;

  IF p_record_kind='evidence' THEN
    IF cardinality(v_transaction_ids)<>0
      OR v_record#>>'{input,evidenceId}' IS DISTINCT FROM p_record_id
      OR v_record#>>'{assessment,evidenceId}' IS DISTINCT FROM p_record_id
      OR v_record#>>'{assessment,status}' NOT IN ('postable_review','refunded_review')
      OR v_record#>>'{assessment,ledgerMutationAllowed}' IS DISTINCT FROM 'false'
    THEN RAISE EXCEPTION 'breeding evidence binding is invalid'; END IF;
  ELSE
    SELECT COALESCE(array_agg(transaction_id ORDER BY transaction_id),ARRAY[]::text[])
    INTO v_json_transaction_ids
    FROM (
      SELECT item->>'transactionId' AS transaction_id
      FROM jsonb_array_elements(v_record#>'{request,costs}') item
      UNION ALL
      SELECT item->>'transactionId' AS transaction_id
      FROM jsonb_array_elements(v_record#>'{request,refunds}') item
    ) transactions;
    IF v_record#>>'{request,assignmentId}' IS DISTINCT FROM p_record_id
      OR v_record#>>'{assessment,assignmentId}' IS DISTINCT FROM p_record_id
      OR v_record#>>'{assessment,status}' IS DISTINCT FROM 'assignment_review'
      OR v_record#>>'{assessment,assignmentMutationAllowed}' IS DISTINCT FROM 'false'
      OR v_record#>>'{assessment,originalAssetsCombined}' IS DISTINCT FROM 'false'
      OR v_record#>>'{assessment,marketValueAssigned}' IS DISTINCT FROM 'false'
      OR v_record#>>'{assessment,realisedGainCalculated}' IS DISTINCT FROM 'false'
      OR v_json_transaction_ids IS DISTINCT FROM v_transaction_ids
    THEN RAISE EXCEPTION 'breeding cost-basis binding is invalid'; END IF;
  END IF;

  INSERT INTO dna.breeding_economic_state(owner_id,economic_version)
  VALUES(p_owner_id,0) ON CONFLICT(owner_id) DO NOTHING;
  SELECT state.economic_version INTO v_version
  FROM dna.breeding_economic_state state WHERE state.owner_id=p_owner_id
  FOR UPDATE;
  SELECT record.fingerprint INTO v_existing
  FROM dna.breeding_economic_record record
  WHERE record.owner_id=p_owner_id AND record.record_id=p_record_id;
  IF FOUND THEN
    RETURN QUERY SELECT CASE WHEN v_existing=p_fingerprint
      THEN 'already_exists' ELSE 'conflict' END,v_existing::text,v_version::text;
    RETURN;
  END IF;
  IF p_expected_economic_version IS NULL
    OR p_expected_economic_version !~ '^(0|[1-9][0-9]*)$'
    OR p_expected_economic_version::numeric<>v_version
  THEN
    RETURN QUERY SELECT 'version_conflict',NULL::text,v_version::text;
    RETURN;
  END IF;
  IF p_record_kind='cost_basis' AND EXISTS(
    SELECT 1 FROM dna.breeding_cost_basis_transaction assigned
    WHERE assigned.owner_id=p_owner_id
      AND assigned.transaction_id=ANY(v_transaction_ids)
  ) THEN RAISE EXCEPTION 'breeding cost transaction already assigned'; END IF;

  INSERT INTO dna.breeding_economic_record(
    owner_id,record_id,record_kind,fingerprint,record_sha256,record_json
  ) VALUES(p_owner_id,p_record_id,p_record_kind,p_fingerprint,
    p_record_sha256,p_record_json);
  IF p_record_kind='cost_basis' THEN
    INSERT INTO dna.breeding_cost_basis_transaction(
      owner_id,transaction_id,assignment_id
    ) SELECT p_owner_id,value,p_record_id FROM unnest(v_transaction_ids) value;
  END IF;
  UPDATE dna.breeding_economic_state AS state
  SET economic_version=state.economic_version+1
  WHERE state.owner_id=p_owner_id
  RETURNING state.economic_version INTO v_version;
  RETURN QUERY SELECT 'created',p_fingerprint::text,v_version::text;
END
$function$;

REVOKE ALL ON TABLE dna.breeding_economic_state FROM PUBLIC,dna_app_runtime;
REVOKE ALL ON TABLE dna.breeding_economic_record FROM PUBLIC,dna_app_runtime;
REVOKE ALL ON TABLE dna.breeding_cost_basis_transaction FROM PUBLIC,dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_breeding_economic_write_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_breeding_economic_record(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_assigned_breeding_cost_transactions(uuid,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.write_breeding_economic_record(uuid,text,text,character,character,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_breeding_economic_write_context(uuid) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_breeding_economic_record(uuid,text) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.list_assigned_breeding_cost_transactions(uuid,text[]) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.write_breeding_economic_record(uuid,text,text,character,character,text,text,text[]) TO dna_app_runtime;

COMMIT;
