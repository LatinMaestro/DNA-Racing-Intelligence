BEGIN;

CREATE TABLE dna.lifecycle_economic_state (
  owner_id uuid PRIMARY KEY REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  lifecycle_version bigint NOT NULL DEFAULT 0 CHECK (lifecycle_version >= 0)
);

CREATE TABLE dna.lifecycle_economic_evidence (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  evidence_id text NOT NULL CHECK (
    length(evidence_id) BETWEEN 8 AND 128 AND
    evidence_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]+$'
  ),
  evidence_kind text NOT NULL CHECK (
    evidence_kind IN ('core_sale','core_burn','burn_bgc_credit')
  ),
  burn_id text,
  fingerprint character(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  record_sha256 character(64) NOT NULL CHECK (record_sha256 ~ '^[a-f0-9]{64}$'),
  record_json text NOT NULL CHECK (
    octet_length(record_json) BETWEEN 2 AND 262144 AND
    jsonb_typeof(record_json::jsonb) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id,evidence_id),
  CHECK (record_sha256 = encode(sha256(convert_to(record_json,'UTF8')),'hex')),
  CHECK ((evidence_kind='burn_bgc_credit') = (burn_id IS NOT NULL))
);

CREATE INDEX lifecycle_economic_credit_burn_idx
  ON dna.lifecycle_economic_evidence(owner_id,burn_id,evidence_id)
  WHERE evidence_kind='burn_bgc_credit';

ALTER TABLE dna.lifecycle_economic_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.lifecycle_economic_state FORCE ROW LEVEL SECURITY;
ALTER TABLE dna.lifecycle_economic_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.lifecycle_economic_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.lifecycle_economic_state
  USING (owner_id=dna.current_owner_id())
  WITH CHECK (owner_id=dna.current_owner_id());
CREATE POLICY owner_isolation ON dna.lifecycle_economic_evidence
  USING (owner_id=dna.current_owner_id())
  WITH CHECK (owner_id=dna.current_owner_id());

CREATE FUNCTION dna.read_lifecycle_economic_write_context(p_owner_id uuid)
RETURNS TABLE(asset_registry_version text,assets_json text,lifecycle_version text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE v_assets jsonb;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped lifecycle economic context denied';
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
    COALESCE((SELECT state.lifecycle_version::text
      FROM dna.lifecycle_economic_state state WHERE state.owner_id=p_owner_id),'0');
END
$function$;

CREATE FUNCTION dna.read_lifecycle_economic_evidence(
  p_owner_id uuid,p_evidence_id text
)
RETURNS TABLE(evidence_kind text,burn_id text,record_json text,
  fingerprint text,record_sha256 text,lifecycle_version text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped lifecycle economic evidence read denied';
  END IF;
  RETURN QUERY SELECT evidence.evidence_kind,evidence.burn_id,
    evidence.record_json,evidence.fingerprint::text,evidence.record_sha256::text,
    COALESCE(state.lifecycle_version,0)::text
  FROM dna.lifecycle_economic_evidence evidence
  LEFT JOIN dna.lifecycle_economic_state state ON state.owner_id=evidence.owner_id
  WHERE evidence.owner_id=p_owner_id AND evidence.evidence_id=p_evidence_id
  LIMIT 1;
END
$function$;

CREATE FUNCTION dna.list_lifecycle_burn_credit_evidence(
  p_owner_id uuid,p_burn_id text
)
RETURNS TABLE(record_json text,fingerprint text,record_sha256 text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped lifecycle burn-credit read denied';
  END IF;
  RETURN QUERY SELECT evidence.record_json,evidence.fingerprint::text,
    evidence.record_sha256::text
  FROM dna.lifecycle_economic_evidence evidence
  WHERE evidence.owner_id=p_owner_id
    AND evidence.evidence_kind='burn_bgc_credit'
    AND evidence.burn_id=p_burn_id
  ORDER BY evidence.evidence_id LIMIT 129;
END
$function$;

CREATE FUNCTION dna.write_lifecycle_economic_evidence(
  p_owner_id uuid,p_evidence_kind text,p_evidence_id text,p_burn_id text,
  p_fingerprint character(64),p_record_sha256 character(64),p_record_json text,
  p_expected_lifecycle_version text
)
RETURNS TABLE(disposition text,fingerprint text,lifecycle_version text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  v_record jsonb;
  v_existing character(64);
  v_version bigint;
  v_burn dna.lifecycle_economic_evidence%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id<>dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped lifecycle economic write denied';
  END IF;
  IF p_evidence_kind NOT IN ('core_sale','core_burn','burn_bgc_credit')
    OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_record_sha256 IS NULL OR p_record_sha256 !~ '^[a-f0-9]{64}$'
    OR encode(sha256(convert_to(p_record_json,'UTF8')),'hex')<>p_record_sha256
  THEN RAISE EXCEPTION 'lifecycle economic candidate is invalid'; END IF;
  v_record:=p_record_json::jsonb;
  IF jsonb_typeof(v_record)<>'object' THEN
    RAISE EXCEPTION 'lifecycle economic record is invalid';
  END IF;
  IF p_evidence_kind='core_sale' AND (
      v_record#>>'{input,saleId}' IS DISTINCT FROM p_evidence_id OR
      v_record#>>'{result,saleId}' IS DISTINCT FROM p_evidence_id OR
      v_record#>>'{result,saleExecutionAllowed}' IS DISTINCT FROM 'false' OR
      v_record#>>'{result,ownershipMutationAllowed}' IS DISTINCT FROM 'false'
    ) THEN RAISE EXCEPTION 'lifecycle sale binding is invalid';
  ELSIF p_evidence_kind='core_burn' AND (
      p_burn_id IS NOT NULL OR
      v_record#>>'{input,burnId}' IS DISTINCT FROM p_evidence_id OR
      v_record#>>'{result,burnId}' IS DISTINCT FROM p_evidence_id OR
      v_record#>>'{input,coreClass}'='Genesis' OR
      v_record#>>'{result,burnExecutionAllowed}' IS DISTINCT FROM 'false' OR
      v_record#>>'{result,ownershipMutationAllowed}' IS DISTINCT FROM 'false' OR
      v_record#>>'{result,burnCreditPredicted}' IS DISTINCT FROM 'false'
    ) THEN RAISE EXCEPTION 'lifecycle burn binding is invalid';
  ELSIF p_evidence_kind='burn_bgc_credit' AND (
      nullif(btrim(p_burn_id),'') IS NULL OR
      v_record#>>'{credit,creditId}' IS DISTINCT FROM p_evidence_id OR
      v_record#>>'{credit,burnId}' IS DISTINCT FROM p_burn_id OR
      upper(v_record#>>'{credit,asset}') IS DISTINCT FROM 'BGC' OR
      upper(v_record#>>'{asset,code}') IS DISTINCT FROM 'BGC' OR
      v_record#>>'{asset,kind}' IS DISTINCT FROM 'game_credit' OR
      v_record#>>'{reconciliation,creditPredicted}' IS DISTINCT FROM 'false' OR
      v_record#>>'{reconciliation,burnEventMutated}' IS DISTINCT FROM 'false'
    ) THEN RAISE EXCEPTION 'lifecycle burn-credit binding is invalid';
  END IF;

  INSERT INTO dna.lifecycle_economic_state(owner_id,lifecycle_version)
  VALUES(p_owner_id,0) ON CONFLICT(owner_id) DO NOTHING;
  SELECT state.lifecycle_version INTO v_version
  FROM dna.lifecycle_economic_state state WHERE state.owner_id=p_owner_id
  FOR UPDATE;
  SELECT evidence.fingerprint INTO v_existing
  FROM dna.lifecycle_economic_evidence evidence
  WHERE evidence.owner_id=p_owner_id AND evidence.evidence_id=p_evidence_id;
  IF FOUND THEN
    RETURN QUERY SELECT CASE WHEN v_existing=p_fingerprint
      THEN 'already_exists' ELSE 'conflict' END,v_existing::text,v_version::text;
    RETURN;
  END IF;
  IF p_expected_lifecycle_version IS NULL
    OR p_expected_lifecycle_version !~ '^(0|[1-9][0-9]*)$'
    OR p_expected_lifecycle_version::numeric<>v_version
  THEN
    RETURN QUERY SELECT 'version_conflict',NULL::text,v_version::text;
    RETURN;
  END IF;
  IF p_evidence_kind='burn_bgc_credit' THEN
    SELECT * INTO v_burn FROM dna.lifecycle_economic_evidence evidence
    WHERE evidence.owner_id=p_owner_id AND evidence.evidence_kind='core_burn'
      AND evidence.evidence_id=p_burn_id FOR UPDATE;
    IF NOT FOUND
      OR v_burn.record_json::jsonb#>>'{result,coreId}'
        IS DISTINCT FROM v_record#>>'{credit,coreId}'
      OR (v_record#>>'{credit,occurredAt}')::timestamptz <
        (v_burn.record_json::jsonb#>>'{input,occurredAt}')::timestamptz
    THEN RAISE EXCEPTION 'lifecycle burn-credit dependency is invalid'; END IF;
  END IF;
  INSERT INTO dna.lifecycle_economic_evidence(
    owner_id,evidence_id,evidence_kind,burn_id,fingerprint,record_sha256,record_json
  ) VALUES(p_owner_id,p_evidence_id,p_evidence_kind,p_burn_id,
    p_fingerprint,p_record_sha256,p_record_json);
  UPDATE dna.lifecycle_economic_state
  SET lifecycle_version=lifecycle_version+1 WHERE owner_id=p_owner_id
  RETURNING lifecycle_version INTO v_version;
  RETURN QUERY SELECT 'created',p_fingerprint::text,v_version::text;
END
$function$;

REVOKE ALL ON TABLE dna.lifecycle_economic_state FROM PUBLIC,dna_app_runtime;
REVOKE ALL ON TABLE dna.lifecycle_economic_evidence FROM PUBLIC,dna_app_runtime;
REVOKE ALL ON FUNCTION dna.read_lifecycle_economic_write_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_lifecycle_economic_evidence(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_lifecycle_burn_credit_evidence(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.write_lifecycle_economic_evidence(uuid,text,text,text,character,character,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.read_lifecycle_economic_write_context(uuid) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_lifecycle_economic_evidence(uuid,text) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.list_lifecycle_burn_credit_evidence(uuid,text) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.write_lifecycle_economic_evidence(uuid,text,text,text,character,character,text,text) TO dna_app_runtime;

COMMIT;
