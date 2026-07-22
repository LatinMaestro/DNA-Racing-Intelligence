BEGIN;

ALTER TABLE dna.import_batch
  ADD CONSTRAINT import_batch_owner_id_source_unique
  UNIQUE (owner_id, id, source_type);

ALTER TABLE dna.dataset_version
  ADD CONSTRAINT dataset_version_owner_id_source_unique
  UNIQUE (owner_id, id, source_type);

ALTER TABLE dna.dataset_version
  ADD CONSTRAINT dataset_version_owner_batch_unique
  UNIQUE (owner_id, import_batch_id);

CREATE TABLE dna.dataset_stream (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (
    source_type IN ('race_merge', 'core_details', 'current_vault', 'current_arena')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, source_type)
);

CREATE TABLE dna.dataset_staged_record (
  owner_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  natural_key text,
  fingerprint_sha256 character(64) CHECK (
    fingerprint_sha256 IS NULL OR fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  status text NOT NULL CHECK (status IN ('ready', 'quarantined')),
  issue_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, import_batch_id, source_row_number),
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE CASCADE,
  CHECK (
    status <> 'ready' OR
    (natural_key IS NOT NULL AND fingerprint_sha256 IS NOT NULL)
  )
);

CREATE TABLE dna.dataset_version_record (
  owner_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('race_merge', 'core_details', 'current_vault', 'current_arena')
  ),
  natural_key text NOT NULL,
  fingerprint_sha256 character(64) NOT NULL CHECK (
    fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  first_accepted_batch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, dataset_version_id, natural_key),
  FOREIGN KEY (owner_id, dataset_version_id, source_type)
    REFERENCES dna.dataset_version(owner_id, id, source_type)
    ON DELETE CASCADE,
  FOREIGN KEY (owner_id, first_accepted_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE RESTRICT
);

CREATE TABLE dna.dataset_record_contribution (
  owner_id uuid NOT NULL,
  source_type text NOT NULL CHECK (
    source_type IN ('race_merge', 'core_details', 'current_vault', 'current_arena')
  ),
  natural_key text NOT NULL,
  import_batch_id uuid NOT NULL,
  fingerprint_sha256 character(64) NOT NULL CHECK (
    fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, source_type, natural_key, import_batch_id),
  FOREIGN KEY (owner_id, import_batch_id, source_type)
    REFERENCES dna.import_batch(owner_id, id, source_type)
    ON DELETE RESTRICT
);

CREATE INDEX dataset_version_record_identity
  ON dna.dataset_version_record(owner_id, source_type, natural_key);

CREATE FUNCTION dna.accept_staged_dataset(
  p_import_batch_id uuid,
  p_dataset_version_id uuid,
  p_import_completed_at timestamptz,
  p_activated_at timestamptz,
  p_data_current_through timestamptz
)
RETURNS TABLE (
  result_status text,
  activated_version_number bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_batch dna.import_batch%ROWTYPE;
  v_active dna.dataset_version%ROWTYPE;
  v_next_version_number bigint;
  v_source_rows bigint;
  v_accepted_rows bigint;
  v_rejected_rows bigint;
  v_warning_rows bigint;
  v_effective_current_through timestamptz;
  v_aggregate_job_id uuid;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for dataset acceptance';
  END IF;

  SELECT *
  INTO v_batch
  FROM dna.import_batch
  WHERE owner_id = v_owner_id AND id = p_import_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner-scoped import batch does not exist';
  END IF;

  IF v_batch.source_type NOT IN (
    'race_merge',
    'core_details',
    'current_vault',
    'current_arena'
  ) THEN
    RAISE EXCEPTION 'source type does not support dataset activation';
  END IF;

  IF v_batch.status = 'accepted' THEN
    SELECT version_number
    INTO v_next_version_number
    FROM dna.dataset_version
    WHERE
      owner_id = v_owner_id
      AND import_batch_id = p_import_batch_id;

    IF v_next_version_number IS NULL THEN
      RAISE EXCEPTION 'accepted batch is missing its dataset version';
    END IF;

    RETURN QUERY SELECT 'idempotent'::text, v_next_version_number;
    RETURN;
  END IF;

  IF v_batch.status <> 'validating' THEN
    RAISE EXCEPTION 'only a validating batch can be accepted';
  END IF;

  IF p_import_completed_at < v_batch.uploaded_at THEN
    RAISE EXCEPTION 'import completion cannot precede upload';
  END IF;

  IF p_activated_at < p_import_completed_at THEN
    RAISE EXCEPTION 'dataset activation cannot precede import completion';
  END IF;

  INSERT INTO dna.dataset_stream (owner_id, source_type)
  VALUES (v_owner_id, v_batch.source_type)
  ON CONFLICT (owner_id, source_type) DO NOTHING;

  PERFORM 1
  FROM dna.dataset_stream
  WHERE owner_id = v_owner_id AND source_type = v_batch.source_type
  FOR UPDATE;

  SELECT *
  INTO v_active
  FROM dna.dataset_version
  WHERE
    owner_id = v_owner_id
    AND source_type = v_batch.source_type
    AND is_active
  FOR UPDATE;

  IF (
    v_active.id IS NOT NULL
    AND v_active.data_current_through IS NOT NULL
    AND p_data_current_through IS NOT NULL
    AND p_data_current_through < v_active.data_current_through
  ) THEN
    UPDATE dna.import_batch
    SET
      status = 'quarantined',
      import_completed_at = p_import_completed_at,
      accepted_rows = 0,
      rejected_rows = source_rows,
      warning_rows = source_rows
    WHERE owner_id = v_owner_id AND id = p_import_batch_id;

    INSERT INTO dna.import_warning (
      id,
      owner_id,
      import_batch_id,
      warning_code,
      severity,
      occurrence_count
    )
    VALUES (
      md5(p_import_batch_id::text || ':STALE_DATA_CURRENT_THROUGH')::uuid,
      v_owner_id,
      p_import_batch_id,
      'STALE_DATA_CURRENT_THROUGH',
      'error',
      GREATEST(v_batch.source_rows, 1)
    );

    RETURN QUERY SELECT 'quarantined'::text, NULL::bigint;
    RETURN;
  END IF;

  WITH conflicting_keys AS (
    SELECT natural_key
    FROM dna.dataset_staged_record
    WHERE
      owner_id = v_owner_id
      AND import_batch_id = p_import_batch_id
      AND status = 'ready'
    GROUP BY natural_key
    HAVING count(DISTINCT fingerprint_sha256) > 1
  )
  UPDATE dna.dataset_staged_record staged
  SET
    status = 'quarantined',
    issue_codes = CASE
      WHEN staged.issue_codes @> ARRAY['INTRA_BATCH_FINGERPRINT_CONFLICT']
        THEN staged.issue_codes
      ELSE array_append(
        staged.issue_codes,
        'INTRA_BATCH_FINGERPRINT_CONFLICT'
      )
    END
  FROM conflicting_keys conflict
  WHERE
    staged.owner_id = v_owner_id
    AND staged.import_batch_id = p_import_batch_id
    AND staged.natural_key = conflict.natural_key;

  IF (
    v_active.id IS NOT NULL
    AND v_batch.source_type IN ('race_merge', 'core_details')
  ) THEN
    UPDATE dna.dataset_staged_record staged
    SET
      status = 'quarantined',
      issue_codes = CASE
        WHEN staged.issue_codes @> ARRAY['FINGERPRINT_CONFLICT']
          THEN staged.issue_codes
        ELSE array_append(staged.issue_codes, 'FINGERPRINT_CONFLICT')
      END
    FROM dna.dataset_version_record accepted
    JOIN dna.dataset_version accepted_version
      ON accepted_version.owner_id = accepted.owner_id
      AND accepted_version.id = accepted.dataset_version_id
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND accepted.owner_id = v_owner_id
      AND accepted.source_type = v_batch.source_type
      AND accepted_version.version_number <= v_active.version_number
      AND accepted_version.rolled_back_at IS NULL
      AND accepted.natural_key = staged.natural_key
      AND accepted.fingerprint_sha256 <> staged.fingerprint_sha256;
  END IF;

  SELECT count(*)
  INTO v_source_rows
  FROM dna.dataset_staged_record
  WHERE owner_id = v_owner_id AND import_batch_id = p_import_batch_id;

  IF v_source_rows <> v_batch.source_rows THEN
    RAISE EXCEPTION 'staged row count does not match import manifest';
  END IF;

  SELECT
    count(*) FILTER (WHERE status = 'ready'),
    count(*) FILTER (WHERE status = 'quarantined'),
    count(*) FILTER (WHERE cardinality(issue_codes) > 0)
  INTO v_accepted_rows, v_rejected_rows, v_warning_rows
  FROM dna.dataset_staged_record
  WHERE owner_id = v_owner_id AND import_batch_id = p_import_batch_id;

  IF v_source_rows > 0 AND v_accepted_rows = 0 THEN
    UPDATE dna.import_batch
    SET
      status = 'quarantined',
      import_completed_at = p_import_completed_at,
      accepted_rows = 0,
      rejected_rows = v_rejected_rows,
      warning_rows = GREATEST(v_warning_rows, 1)
    WHERE owner_id = v_owner_id AND id = p_import_batch_id;

    INSERT INTO dna.import_warning (
      id,
      owner_id,
      import_batch_id,
      warning_code,
      severity,
      occurrence_count
    )
    VALUES (
      md5(p_import_batch_id::text || ':NO_ACCEPTABLE_ROWS')::uuid,
      v_owner_id,
      p_import_batch_id,
      'NO_ACCEPTABLE_ROWS',
      'error',
      v_source_rows
    );

    INSERT INTO dna.import_warning (
      id,
      owner_id,
      import_batch_id,
      warning_code,
      severity,
      occurrence_count
    )
    SELECT
      md5(p_import_batch_id::text || ':' || issue.issue_code)::uuid,
      v_owner_id,
      p_import_batch_id,
      issue.issue_code,
      'error',
      count(*)
    FROM dna.dataset_staged_record staged
    CROSS JOIN LATERAL unnest(staged.issue_codes) AS issue(issue_code)
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
    GROUP BY issue.issue_code
    ON CONFLICT (owner_id, id) DO NOTHING;

    RETURN QUERY SELECT 'quarantined'::text, NULL::bigint;
    RETURN;
  END IF;

  SELECT COALESCE(max(version_number), 0) + 1
  INTO v_next_version_number
  FROM dna.dataset_version
  WHERE owner_id = v_owner_id AND source_type = v_batch.source_type;

  UPDATE dna.dataset_version
  SET is_active = false
  WHERE
    owner_id = v_owner_id
    AND source_type = v_batch.source_type
    AND is_active;

  v_effective_current_through := COALESCE(
    p_data_current_through,
    v_active.data_current_through
  );

  INSERT INTO dna.dataset_version (
    id,
    owner_id,
    source_type,
    version_number,
    import_batch_id,
    activated_at,
    data_current_through,
    aggregate_refreshed_at,
    is_active
  )
  VALUES (
    p_dataset_version_id,
    v_owner_id,
    v_batch.source_type,
    v_next_version_number,
    p_import_batch_id,
    p_activated_at,
    v_effective_current_through,
    NULL,
    true
  );

  IF v_batch.source_type IN ('race_merge', 'core_details') THEN
    INSERT INTO dna.dataset_version_record (
      owner_id,
      dataset_version_id,
      source_type,
      natural_key,
      fingerprint_sha256,
      first_accepted_batch_id
    )
    SELECT DISTINCT ON (staged.natural_key)
      v_owner_id,
      p_dataset_version_id,
      v_batch.source_type,
      staged.natural_key,
      staged.fingerprint_sha256,
      p_import_batch_id
    FROM dna.dataset_staged_record staged
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND NOT EXISTS (
        SELECT 1
        FROM dna.dataset_version_record existing
        JOIN dna.dataset_version existing_version
          ON existing_version.owner_id = existing.owner_id
          AND existing_version.id = existing.dataset_version_id
        WHERE
          existing.owner_id = v_owner_id
          AND existing.source_type = v_batch.source_type
          AND existing.natural_key = staged.natural_key
          AND existing_version.rolled_back_at IS NULL
          AND (
            v_active.id IS NULL OR
            existing_version.version_number <= v_active.version_number
          )
      )
    ORDER BY staged.natural_key, staged.source_row_number;
  ELSE
    INSERT INTO dna.dataset_version_record (
      owner_id,
      dataset_version_id,
      source_type,
      natural_key,
      fingerprint_sha256,
      first_accepted_batch_id
    )
    SELECT DISTINCT ON (staged.natural_key)
      v_owner_id,
      p_dataset_version_id,
      v_batch.source_type,
      staged.natural_key,
      staged.fingerprint_sha256,
      CASE
        WHEN previous.fingerprint_sha256 = staged.fingerprint_sha256
          THEN previous.first_accepted_batch_id
        ELSE p_import_batch_id
      END
    FROM dna.dataset_staged_record staged
    LEFT JOIN dna.dataset_version_record previous
      ON previous.owner_id = v_owner_id
      AND previous.dataset_version_id = v_active.id
      AND previous.natural_key = staged.natural_key
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
    ORDER BY staged.natural_key, staged.source_row_number;
  END IF;

  INSERT INTO dna.dataset_record_contribution (
    owner_id,
    source_type,
    natural_key,
    import_batch_id,
    fingerprint_sha256
  )
  SELECT DISTINCT
    v_owner_id,
    v_batch.source_type,
    staged.natural_key,
    p_import_batch_id,
    staged.fingerprint_sha256
  FROM dna.dataset_staged_record staged
  WHERE
    staged.owner_id = v_owner_id
    AND staged.import_batch_id = p_import_batch_id
    AND staged.status = 'ready'
  ON CONFLICT DO NOTHING;

  INSERT INTO dna.import_warning (
    id,
    owner_id,
    import_batch_id,
    warning_code,
    severity,
    occurrence_count
  )
  SELECT
    md5(p_import_batch_id::text || ':' || issue.issue_code)::uuid,
    v_owner_id,
    p_import_batch_id,
    issue.issue_code,
    'error',
    count(*)
  FROM dna.dataset_staged_record staged
  CROSS JOIN LATERAL unnest(staged.issue_codes) AS issue(issue_code)
  WHERE
    staged.owner_id = v_owner_id
    AND staged.import_batch_id = p_import_batch_id
  GROUP BY issue.issue_code
  ON CONFLICT (owner_id, id) DO NOTHING;

  UPDATE dna.import_batch
  SET
    status = 'accepted',
    import_completed_at = p_import_completed_at,
    accepted_rows = v_accepted_rows,
    rejected_rows = v_rejected_rows,
    warning_rows = v_warning_rows,
    dataset_current_through_after_import = v_effective_current_through
  WHERE owner_id = v_owner_id AND id = p_import_batch_id;

  v_aggregate_job_id := md5(
    p_dataset_version_id::text || ':aggregate-refresh'
  )::uuid;

  INSERT INTO dna.aggregate_refresh_job (
    id,
    owner_id,
    dataset_version_id,
    status
  )
  VALUES (
    v_aggregate_job_id,
    v_owner_id,
    p_dataset_version_id,
    'queued'
  );

  RETURN QUERY SELECT 'accepted'::text, v_next_version_number;
END
$function$;

CREATE FUNCTION dna.rollback_active_dataset(
  p_source_type text,
  p_reason text,
  p_rolled_back_at timestamptz
)
RETURNS TABLE (
  rolled_back_version_number bigint,
  restored_version_number bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_active dna.dataset_version%ROWTYPE;
  v_restored dna.dataset_version%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for dataset rollback';
  END IF;

  IF p_source_type NOT IN (
    'race_merge',
    'core_details',
    'current_vault',
    'current_arena'
  ) THEN
    RAISE EXCEPTION 'unsupported dataset source type';
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'rollback reason is required';
  END IF;

  PERFORM 1
  FROM dna.dataset_stream
  WHERE owner_id = v_owner_id AND source_type = p_source_type
  FOR UPDATE;

  SELECT *
  INTO v_active
  FROM dna.dataset_version
  WHERE
    owner_id = v_owner_id
    AND source_type = p_source_type
    AND is_active
  FOR UPDATE;

  IF v_active.id IS NULL THEN
    RAISE EXCEPTION 'no active dataset version exists';
  END IF;

  UPDATE dna.dataset_version
  SET is_active = false, rolled_back_at = p_rolled_back_at
  WHERE owner_id = v_owner_id AND id = v_active.id;

  UPDATE dna.import_batch
  SET
    status = 'rolled_back',
    rollback_reason = btrim(p_reason),
    rolled_back_at = p_rolled_back_at
  WHERE owner_id = v_owner_id AND id = v_active.import_batch_id;

  UPDATE dna.aggregate_refresh_job
  SET
    status = 'rolled_back',
    completed_at = COALESCE(completed_at, p_rolled_back_at),
    started_at = COALESCE(started_at, p_rolled_back_at)
  WHERE
    owner_id = v_owner_id
    AND dataset_version_id = v_active.id
    AND status IN ('queued', 'running');

  SELECT *
  INTO v_restored
  FROM dna.dataset_version
  WHERE
    owner_id = v_owner_id
    AND source_type = p_source_type
    AND version_number < v_active.version_number
    AND rolled_back_at IS NULL
  ORDER BY version_number DESC
  LIMIT 1
  FOR UPDATE;

  IF v_restored.id IS NOT NULL THEN
    UPDATE dna.dataset_version
    SET is_active = true
    WHERE owner_id = v_owner_id AND id = v_restored.id;
  END IF;

  RETURN QUERY
  SELECT v_active.version_number, v_restored.version_number;
END
$function$;

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dataset_stream',
    'dataset_staged_record',
    'dataset_version_record',
    'dataset_record_contribution'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY',
      table_name
    );
    EXECUTE format(
      'ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY owner_isolation ON dna.%I USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id())',
      table_name
    );
  END LOOP;
END
$policies$;

REVOKE ALL ON TABLE dna.dataset_stream FROM PUBLIC;
REVOKE ALL ON TABLE dna.dataset_staged_record FROM PUBLIC;
REVOKE ALL ON TABLE dna.dataset_version_record FROM PUBLIC;
REVOKE ALL ON TABLE dna.dataset_record_contribution FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.accept_staged_dataset(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset(
  text,
  text,
  timestamptz
) FROM PUBLIC;

COMMIT;
