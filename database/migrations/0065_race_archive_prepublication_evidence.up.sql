BEGIN;

CREATE TABLE dna.race_archive_prepublication_evidence_receipt (
  owner_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type = 'race_merge'),
  source_row_count bigint NOT NULL CHECK (source_row_count > 0),
  accepted_row_count bigint NOT NULL CHECK (accepted_row_count > 0),
  evidence_kind text NOT NULL CHECK (evidence_kind = 'staged_rows'),
  evidence_partition_count integer NOT NULL CHECK (
    evidence_partition_count BETWEEN 1 AND 10000
  ),
  evidence_row_count bigint NOT NULL CHECK (evidence_row_count > 0),
  evidence_byte_size bigint NOT NULL CHECK (evidence_byte_size > 0),
  manifest_fingerprint uuid NOT NULL,
  final_receipt_required boolean NOT NULL DEFAULT false,
  prepared_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, dataset_version_id),
  UNIQUE (owner_id, import_batch_id),
  FOREIGN KEY (owner_id, dataset_version_id, source_type)
    REFERENCES dna.dataset_version(owner_id, id, source_type)
    ON DELETE CASCADE,
  FOREIGN KEY (owner_id, import_batch_id, source_type)
    REFERENCES dna.import_batch(owner_id, id, source_type)
    ON DELETE CASCADE,
  CHECK (source_row_count = evidence_row_count)
);

ALTER TABLE dna.race_archive_prepublication_evidence_receipt
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_archive_prepublication_evidence_receipt
  FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation
  ON dna.race_archive_prepublication_evidence_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.race_archive_prepublication_evidence_summary(
  p_owner_id uuid,
  p_import_batch_id uuid
)
RETURNS TABLE (
  evidence_partition_count integer,
  evidence_row_count bigint,
  evidence_byte_size bigint,
  manifest_fingerprint uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_partition_count integer;
  v_row_count bigint;
  v_byte_size bigint;
  v_min_partition integer;
  v_max_partition integer;
  v_manifest_fingerprint uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.dataset_evidence_object object
    WHERE object.owner_id = p_owner_id
      AND object.import_batch_id = p_import_batch_id
      AND object.source_type = 'race_merge'
      AND object.object_kind = 'normalized_partition'
  ) THEN
    RAISE EXCEPTION 'Race archive pre-publication evidence coverage is ambiguous';
  END IF;

  SELECT
    count(*)::integer,
    COALESCE(sum(object.row_count), 0)::bigint,
    COALESCE(sum(object.byte_size), 0)::bigint,
    min(object.partition_number),
    max(object.partition_number),
    md5(string_agg(
      object.partition_number::text || chr(31) ||
      object.object_format || chr(31) ||
      object.object_key || chr(31) ||
      object.checksum_sha256::text || chr(31) ||
      object.byte_size::text || chr(31) ||
      object.row_count::text || chr(31) ||
      COALESCE(object.first_natural_key, chr(29)) || chr(31) ||
      COALESCE(object.last_natural_key, chr(29)),
      chr(30) ORDER BY object.partition_number
    ))::uuid
  INTO
    v_partition_count,
    v_row_count,
    v_byte_size,
    v_min_partition,
    v_max_partition,
    v_manifest_fingerprint
  FROM dna.dataset_evidence_object object
  WHERE object.owner_id = p_owner_id
    AND object.import_batch_id = p_import_batch_id
    AND object.source_type = 'race_merge'
    AND object.object_kind = 'staged_rows';

  IF v_partition_count NOT BETWEEN 1 AND 10000
     OR v_min_partition <> 0
     OR v_max_partition <> v_partition_count - 1
     OR v_row_count <= 0
     OR v_byte_size <= 0
     OR v_manifest_fingerprint IS NULL THEN
    RAISE EXCEPTION 'Race archive pre-publication evidence coverage is unavailable';
  END IF;

  RETURN QUERY SELECT
    v_partition_count,
    v_row_count,
    v_byte_size,
    v_manifest_fingerprint;
END
$function$;

CREATE FUNCTION dna.prepare_race_archive_prepublication_evidence(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_target_dataset_version_id uuid,
  p_source_version_set_sha256 character(64),
  p_dataset_version_id uuid,
  p_prepared_at timestamptz
)
RETURNS TABLE (
  status text,
  evidence_partition_count integer,
  evidence_row_count bigint,
  evidence_byte_size bigint,
  manifest_fingerprint uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_target dna.dataset_version%ROWTYPE;
  v_version dna.dataset_version%ROWTYPE;
  v_batch dna.import_batch%ROWTYPE;
  v_existing dna.race_archive_prepublication_evidence_receipt%ROWTYPE;
  v_summary record;
  v_final_receipt_exists boolean;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive pre-publication evidence denied';
  END IF;
  IF p_prepared_at IS NULL THEN
    RAISE EXCEPTION 'Race archive pre-publication evidence timestamp is required';
  END IF;
  IF p_source_version_set_sha256 IS NULL
     OR p_source_version_set_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race archive pre-publication source-version checksum is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.refresh_id = p_refresh_id
      AND processing.dataset_version_id = p_target_dataset_version_id
      AND processing.state = 'processing'
      AND processing.source_version_set_sha256 = p_source_version_set_sha256
  ) THEN
    RAISE EXCEPTION 'Race archive pre-publication refresh claim is unavailable';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'Race archive pre-publication source versions were superseded';
  END IF;

  SELECT version.* INTO v_target
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_target_dataset_version_id
    AND version.source_type = 'race_merge'
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active Race Merge pre-publication target is unavailable';
  END IF;

  SELECT version.* INTO v_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
    AND version.version_number <= v_target.version_number
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Race Merge pre-publication dataset version is unavailable';
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = v_version.import_batch_id
    AND batch.source_type = 'race_merge'
  FOR SHARE;

  IF NOT FOUND OR v_batch.status <> 'accepted'
     OR v_batch.source_rows <= 0 OR v_batch.accepted_rows <= 0 THEN
    RAISE EXCEPTION 'accepted Race Merge pre-publication batch is unavailable';
  END IF;

  SELECT * INTO STRICT v_summary
  FROM dna.race_archive_prepublication_evidence_summary(
    p_owner_id,
    v_batch.id
  );

  IF v_summary.evidence_row_count <> v_batch.source_rows THEN
    RAISE EXCEPTION 'Race archive pre-publication evidence does not cover source rows';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM dna.dataset_version_evidence_receipt receipt
    WHERE receipt.owner_id = p_owner_id
      AND receipt.dataset_version_id = v_version.id
      AND receipt.import_batch_id = v_batch.id
      AND receipt.source_type = 'race_merge'
      AND receipt.evidence_kind = 'staged_rows'
      AND receipt.evidence_partition_count = v_summary.evidence_partition_count
      AND receipt.evidence_row_count = v_summary.evidence_row_count
      AND receipt.evidence_byte_size = v_summary.evidence_byte_size
  ) INTO v_final_receipt_exists;

  SELECT receipt.* INTO v_existing
  FROM dna.race_archive_prepublication_evidence_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.dataset_version_id = v_version.id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.import_batch_id <> v_batch.id
       OR v_existing.source_type <> 'race_merge'
       OR v_existing.source_row_count <> v_batch.source_rows
       OR v_existing.accepted_row_count <> v_batch.accepted_rows
       OR v_existing.evidence_kind <> 'staged_rows'
       OR v_existing.evidence_partition_count <>
          v_summary.evidence_partition_count
       OR v_existing.evidence_row_count <> v_summary.evidence_row_count
       OR v_existing.evidence_byte_size <> v_summary.evidence_byte_size
       OR v_existing.manifest_fingerprint <> v_summary.manifest_fingerprint THEN
      RAISE EXCEPTION 'Race archive pre-publication evidence replay conflict';
    END IF;
    IF v_existing.final_receipt_required AND NOT v_final_receipt_exists THEN
      RAISE EXCEPTION 'complete sealed Race archive aggregate evidence is unavailable';
    END IF;
    IF v_final_receipt_exists AND NOT v_existing.final_receipt_required THEN
      UPDATE dna.race_archive_prepublication_evidence_receipt
      SET final_receipt_required = true
      WHERE owner_id = p_owner_id
        AND dataset_version_id = v_version.id;
    END IF;

    RETURN QUERY SELECT
      'existing'::text,
      v_existing.evidence_partition_count,
      v_existing.evidence_row_count,
      v_existing.evidence_byte_size,
      v_existing.manifest_fingerprint;
    RETURN;
  END IF;

  INSERT INTO dna.race_archive_prepublication_evidence_receipt (
    owner_id,
    dataset_version_id,
    import_batch_id,
    source_type,
    source_row_count,
    accepted_row_count,
    evidence_kind,
    evidence_partition_count,
    evidence_row_count,
    evidence_byte_size,
    manifest_fingerprint,
    final_receipt_required,
    prepared_at
  ) VALUES (
    p_owner_id,
    v_version.id,
    v_batch.id,
    'race_merge',
    v_batch.source_rows,
    v_batch.accepted_rows,
    'staged_rows',
    v_summary.evidence_partition_count,
    v_summary.evidence_row_count,
    v_summary.evidence_byte_size,
    v_summary.manifest_fingerprint,
    v_final_receipt_exists,
    p_prepared_at
  );

  RETURN QUERY SELECT
    'prepared'::text,
    v_summary.evidence_partition_count,
    v_summary.evidence_row_count,
    v_summary.evidence_byte_size,
    v_summary.manifest_fingerprint;
END
$function$;

ALTER FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) RENAME TO list_race_archive_refresh_versions_pre_0065;

ALTER FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
) RENAME TO seal_dataset_version_evidence_pre_0065;

REVOKE ALL ON FUNCTION dna.list_race_archive_refresh_versions_pre_0065(
  uuid, uuid, uuid, character, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_race_archive_refresh_versions_pre_0065(
  uuid, uuid, uuid, character, integer
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.seal_dataset_version_evidence_pre_0065(
  uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.seal_dataset_version_evidence_pre_0065(
  uuid, uuid, timestamptz
) FROM dna_app_runtime;

CREATE FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_source_version_set_sha256 character(64),
  p_maximum_versions integer
)
RETURNS TABLE (
  dataset_version_id uuid,
  import_batch_id uuid,
  version_number bigint,
  source_row_count bigint,
  accepted_row_count bigint,
  evidence_partition_count integer,
  evidence_row_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_target_version dna.dataset_version%ROWTYPE;
  v_version_count bigint;
  v_version record;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race archive aggregate refresh plan denied';
  END IF;
  IF p_source_version_set_sha256 IS NULL
     OR p_source_version_set_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Race archive aggregate source-version checksum is invalid';
  END IF;
  IF p_maximum_versions IS NULL OR p_maximum_versions NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Race archive aggregate version bound is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_processing processing
    WHERE processing.owner_id = p_owner_id
      AND processing.refresh_id = p_refresh_id
      AND processing.dataset_version_id = p_dataset_version_id
      AND processing.state = 'processing'
      AND processing.source_version_set_sha256 = p_source_version_set_sha256
  ) THEN
    RAISE EXCEPTION 'Race archive aggregate refresh claim is unavailable';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> p_source_version_set_sha256 THEN
    RAISE EXCEPTION 'Race archive aggregate source versions were superseded';
  END IF;

  SELECT version.* INTO v_target_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
    AND version.source_type = 'race_merge'
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active Race Merge aggregate target version is unavailable';
  END IF;

  SELECT count(*)::bigint INTO v_version_count
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
    AND version.version_number <= v_target_version.version_number;

  IF v_version_count < 1 OR v_version_count > p_maximum_versions THEN
    RAISE EXCEPTION 'Race archive aggregate version count exceeds its bound';
  END IF;

  FOR v_version IN
    SELECT version.id
    FROM dna.dataset_version version
    WHERE version.owner_id = p_owner_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
      AND version.version_number <= v_target_version.version_number
    ORDER BY version.version_number, version.id
  LOOP
    PERFORM *
    FROM dna.prepare_race_archive_prepublication_evidence(
      p_owner_id,
      p_refresh_id,
      p_dataset_version_id,
      p_source_version_set_sha256,
      v_version.id,
      now()
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM dna.dataset_version version
    JOIN dna.import_batch batch
      ON batch.owner_id = version.owner_id
      AND batch.id = version.import_batch_id
      AND batch.source_type = 'race_merge'
    LEFT JOIN dna.race_archive_prepublication_evidence_receipt evidence
      ON evidence.owner_id = version.owner_id
      AND evidence.dataset_version_id = version.id
      AND evidence.import_batch_id = version.import_batch_id
      AND evidence.source_type = 'race_merge'
    WHERE version.owner_id = p_owner_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
      AND version.version_number <= v_target_version.version_number
      AND (
        batch.status <> 'accepted'
        OR batch.source_rows <= 0
        OR batch.accepted_rows <= 0
        OR evidence.dataset_version_id IS NULL
        OR evidence.evidence_kind <> 'staged_rows'
        OR evidence.evidence_partition_count NOT BETWEEN 1 AND 10000
        OR evidence.evidence_row_count <> batch.source_rows
        OR evidence.evidence_byte_size <= 0
      )
  ) THEN
    RAISE EXCEPTION 'complete Race archive pre-publication evidence is unavailable';
  END IF;

  RETURN QUERY
  SELECT
    version.id,
    version.import_batch_id,
    version.version_number,
    batch.source_rows,
    batch.accepted_rows,
    evidence.evidence_partition_count,
    evidence.evidence_row_count
  FROM dna.dataset_version version
  JOIN dna.import_batch batch
    ON batch.owner_id = version.owner_id
    AND batch.id = version.import_batch_id
    AND batch.source_type = 'race_merge'
    AND batch.status = 'accepted'
  JOIN dna.race_archive_prepublication_evidence_receipt evidence
    ON evidence.owner_id = version.owner_id
    AND evidence.dataset_version_id = version.id
    AND evidence.import_batch_id = version.import_batch_id
    AND evidence.source_type = 'race_merge'
    AND evidence.evidence_kind = 'staged_rows'
  WHERE version.owner_id = p_owner_id
    AND version.source_type = 'race_merge'
    AND version.rolled_back_at IS NULL
    AND version.version_number <= v_target_version.version_number
  ORDER BY version.version_number, version.id;
END
$function$;

CREATE FUNCTION dna.seal_dataset_version_evidence(
  p_owner_id uuid,
  p_dataset_version_id uuid,
  p_sealed_at timestamptz
)
RETURNS TABLE (
  status text,
  evidence_kind text,
  evidence_partition_count integer,
  evidence_row_count bigint,
  evidence_byte_size bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_version dna.dataset_version%ROWTYPE;
  v_batch dna.import_batch%ROWTYPE;
  v_prepublication dna.race_archive_prepublication_evidence_receipt%ROWTYPE;
  v_summary record;
  v_has_archive_publication boolean;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped dataset version evidence sealing denied';
  END IF;

  SELECT version.* INTO v_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = p_dataset_version_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped dataset version does not exist';
  END IF;

  IF v_version.source_type = 'race_merge' THEN
    SELECT receipt.* INTO v_prepublication
    FROM dna.race_archive_prepublication_evidence_receipt receipt
    WHERE receipt.owner_id = p_owner_id
      AND receipt.dataset_version_id = p_dataset_version_id
      AND receipt.import_batch_id = v_version.import_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
      SELECT EXISTS (
        SELECT 1
        FROM dna.race_archive_aggregate_publication_receipt publication
        WHERE publication.owner_id = p_owner_id
          AND publication.race_dataset_version_id = p_dataset_version_id
      ) INTO v_has_archive_publication;

      IF v_has_archive_publication THEN
        RAISE EXCEPTION 'Race archive pre-publication evidence is unavailable at final sealing';
      END IF;

      RETURN QUERY
      SELECT previous.status,
        previous.evidence_kind,
        previous.evidence_partition_count,
        previous.evidence_row_count,
        previous.evidence_byte_size
      FROM dna.seal_dataset_version_evidence_pre_0065(
        p_owner_id,
        p_dataset_version_id,
        p_sealed_at
      ) previous;
      RETURN;
    END IF;

    SELECT batch.* INTO v_batch
    FROM dna.import_batch batch
    WHERE batch.owner_id = p_owner_id
      AND batch.id = v_version.import_batch_id
      AND batch.source_type = 'race_merge'
    FOR SHARE;

    IF NOT FOUND OR v_batch.status <> 'accepted'
       OR v_prepublication.source_row_count <> v_batch.source_rows
       OR v_prepublication.accepted_row_count <> v_batch.accepted_rows THEN
      RAISE EXCEPTION 'Race archive pre-publication batch identity changed before sealing';
    END IF;

    SELECT * INTO STRICT v_summary
    FROM dna.race_archive_prepublication_evidence_summary(
      p_owner_id,
      v_batch.id
    );

    IF v_prepublication.evidence_kind <> 'staged_rows'
       OR v_prepublication.evidence_partition_count <>
          v_summary.evidence_partition_count
       OR v_prepublication.evidence_row_count <> v_summary.evidence_row_count
       OR v_prepublication.evidence_byte_size <> v_summary.evidence_byte_size
       OR v_prepublication.manifest_fingerprint <>
          v_summary.manifest_fingerprint THEN
      RAISE EXCEPTION 'Race archive pre-publication evidence changed before final sealing';
    END IF;

    IF v_prepublication.final_receipt_required AND NOT EXISTS (
      SELECT 1
      FROM dna.dataset_version_evidence_receipt receipt
      WHERE receipt.owner_id = p_owner_id
        AND receipt.dataset_version_id = p_dataset_version_id
        AND receipt.import_batch_id = v_batch.id
        AND receipt.source_type = 'race_merge'
    ) THEN
      RAISE EXCEPTION 'required post-aggregate Race evidence receipt is unavailable';
    END IF;
  END IF;

  RETURN QUERY
  SELECT previous.status,
    previous.evidence_kind,
    previous.evidence_partition_count,
    previous.evidence_row_count,
    previous.evidence_byte_size
  FROM dna.seal_dataset_version_evidence_pre_0065(
    p_owner_id,
    p_dataset_version_id,
    p_sealed_at
  ) previous;

  IF v_version.source_type = 'race_merge'
     AND v_prepublication.dataset_version_id IS NOT NULL THEN
    UPDATE dna.race_archive_prepublication_evidence_receipt
    SET final_receipt_required = true
    WHERE owner_id = p_owner_id
      AND dataset_version_id = p_dataset_version_id;
  END IF;
END
$function$;

REVOKE ALL ON TABLE dna.race_archive_prepublication_evidence_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.race_archive_prepublication_evidence_summary(
  uuid, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.race_archive_prepublication_evidence_summary(
  uuid, uuid
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.prepare_race_archive_prepublication_evidence(
  uuid, uuid, uuid, character, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.prepare_race_archive_prepublication_evidence(
  uuid, uuid, uuid, character, uuid, timestamptz
) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.race_archive_prepublication_evidence_receipt
  TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
) TO dna_app_runtime;

COMMENT ON TABLE dna.race_archive_prepublication_evidence_receipt IS
  'Owner-scoped immutable staged-row archive evidence locked before Race aggregate reconstruction. This is not the post-aggregate sealing/compaction receipt.';

COMMENT ON FUNCTION dna.list_race_archive_aggregate_refresh_versions(
  uuid, uuid, uuid, character, integer
) IS
  'Returns the exact ordered Race Merge archive refresh plan after locking complete immutable staged-row evidence for each version. Post-aggregate dataset_version_evidence_receipt sealing remains a later publication boundary.';

COMMENT ON FUNCTION dna.seal_dataset_version_evidence(
  uuid, uuid, timestamptz
) IS
  'Preserves post-aggregate evidence sealing. Archive-backed Race sealing additionally verifies the exact pre-publication staged-row manifest has not drifted before delegating to the prior sealing contract.';

COMMIT;
