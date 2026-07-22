BEGIN;

CREATE TABLE dna.normalized_vault_staged_fact (
  owner_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  core_class text NOT NULL CHECK (
    core_class IN ('Genesis', 'Morphed', 'Freak', 'X-Class')
  ),
  element text NOT NULL CHECK (element IN ('Metal', 'Fire', 'Earth', 'Water')),
  f_number integer NOT NULL CHECK (f_number > 0),
  sex text NOT NULL CHECK (sex IN ('male', 'female')),
  maiden_eligible boolean,
  maiden_source_value text NOT NULL,
  maiden_data_status text NOT NULL CHECK (
    maiden_data_status IN ('valid', 'missing', 'invalid')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, import_batch_id, source_row_number),
  FOREIGN KEY (owner_id, import_batch_id, source_row_number)
    REFERENCES dna.dataset_staged_record(
      owner_id,
      import_batch_id,
      source_row_number
    ) ON DELETE CASCADE,
  CHECK (
    (maiden_data_status = 'valid' AND maiden_eligible IS NOT NULL) OR
    (maiden_data_status <> 'valid' AND maiden_eligible IS NULL)
  )
);

CREATE TABLE dna.normalized_arena_staged_fact (
  owner_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  source_core_id text NOT NULL CHECK (btrim(source_core_id) <> ''),
  price_usd_source_value text NOT NULL CHECK (
    price_usd_source_value ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
  ),
  creates_economic_transaction boolean NOT NULL DEFAULT false CHECK (
    NOT creates_economic_transaction
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, import_batch_id, source_row_number),
  FOREIGN KEY (owner_id, import_batch_id, source_row_number)
    REFERENCES dna.dataset_staged_record(
      owner_id,
      import_batch_id,
      source_row_number
    ) ON DELETE CASCADE
);

CREATE TABLE dna.vault_snapshot_entry (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  vault_snapshot_id uuid NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  source_record_key text NOT NULL CHECK (btrim(source_record_key) <> ''),
  raw_source_name text NOT NULL,
  core_class text NOT NULL CHECK (
    core_class IN ('Genesis', 'Morphed', 'Freak', 'X-Class')
  ),
  element text NOT NULL CHECK (element IN ('Metal', 'Fire', 'Earth', 'Water')),
  f_number integer NOT NULL CHECK (f_number > 0),
  sex text NOT NULL CHECK (sex IN ('male', 'female')),
  maiden_state text NOT NULL CHECK (
    maiden_state IN ('eligible', 'not_eligible', 'unknown', 'invalid')
  ),
  maiden_source_value text NOT NULL,
  identity_review_id uuid NOT NULL,
  proposed_core_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, vault_snapshot_id, source_row_number),
  UNIQUE (owner_id, vault_snapshot_id, source_record_key),
  FOREIGN KEY (owner_id, vault_snapshot_id)
    REFERENCES dna.vault_snapshot(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, identity_review_id)
    REFERENCES dna.identity_review(owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, proposed_core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE SET NULL (proposed_core_id)
);

CREATE TABLE dna.arena_snapshot_entry (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  arena_snapshot_id uuid NOT NULL,
  source_row_number bigint NOT NULL CHECK (source_row_number > 0),
  source_core_id text NOT NULL CHECK (btrim(source_core_id) <> ''),
  core_id uuid,
  identity_review_id uuid,
  price_usd_source_value text NOT NULL CHECK (
    price_usd_source_value ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
  ),
  creates_economic_transaction boolean NOT NULL DEFAULT false CHECK (
    NOT creates_economic_transaction
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, arena_snapshot_id, source_row_number),
  UNIQUE (owner_id, arena_snapshot_id, source_core_id),
  FOREIGN KEY (owner_id, arena_snapshot_id)
    REFERENCES dna.arena_snapshot(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, core_id)
    REFERENCES dna.core(owner_id, id) ON DELETE SET NULL (core_id),
  FOREIGN KEY (owner_id, identity_review_id)
    REFERENCES dna.identity_review(owner_id, id) ON DELETE RESTRICT,
  CHECK ((core_id IS NULL) = (identity_review_id IS NOT NULL))
);

CREATE VIEW dna.current_vault_snapshot_entry
WITH (security_invoker = true)
AS
SELECT entry.*
FROM dna.vault_snapshot_entry entry
JOIN dna.vault_snapshot snapshot
  ON snapshot.owner_id = entry.owner_id
  AND snapshot.id = entry.vault_snapshot_id
WHERE snapshot.is_current;

CREATE VIEW dna.current_arena_snapshot_entry
WITH (security_invoker = true)
AS
SELECT entry.*
FROM dna.arena_snapshot_entry entry
JOIN dna.arena_snapshot snapshot
  ON snapshot.owner_id = entry.owner_id
  AND snapshot.id = entry.arena_snapshot_id
WHERE snapshot.is_current;

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'normalized_vault_staged_fact',
    'normalized_arena_staged_fact',
    'vault_snapshot_entry',
    'arena_snapshot_entry'
  ]
  LOOP
    EXECUTE format('ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY owner_isolation ON dna.%I USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id())',
      table_name
    );
  END LOOP;
END
$policies$;

CREATE FUNCTION dna.accept_staged_vault_dataset(
  p_import_batch_id uuid,
  p_dataset_version_id uuid,
  p_import_completed_at timestamptz,
  p_activated_at timestamptz,
  p_data_current_through timestamptz
)
RETURNS TABLE (
  result_status text,
  activated_version_number bigint,
  snapshot_id uuid,
  entry_count bigint,
  review_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_batch dna.import_batch%ROWTYPE;
  v_result_status text;
  v_version_number bigint;
  v_snapshot_id uuid;
  v_entry_count bigint;
  v_review_count bigint;
  v_effective_current_through timestamptz;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for Vault acceptance';
  END IF;

  SELECT * INTO v_batch
  FROM dna.import_batch
  WHERE owner_id = v_owner_id AND id = p_import_batch_id
  FOR UPDATE;

  IF v_batch.id IS NULL OR v_batch.source_type <> 'current_vault' THEN
    RAISE EXCEPTION 'owner-scoped Current Vault import batch does not exist';
  END IF;

  IF v_batch.status = 'accepted' THEN
    SELECT version_number INTO v_version_number
    FROM dna.dataset_version
    WHERE owner_id = v_owner_id AND import_batch_id = p_import_batch_id;

    SELECT id INTO v_snapshot_id
    FROM dna.vault_snapshot
    WHERE owner_id = v_owner_id AND import_batch_id = p_import_batch_id;

    SELECT count(*) INTO v_entry_count
    FROM dna.vault_snapshot_entry
    WHERE owner_id = v_owner_id AND vault_snapshot_id = v_snapshot_id;

    SELECT count(*) INTO v_review_count
    FROM dna.vault_snapshot_entry
    WHERE
      owner_id = v_owner_id
      AND vault_snapshot_id = v_snapshot_id
      AND identity_review_id IS NOT NULL;

    RETURN QUERY SELECT 'idempotent'::text, v_version_number, v_snapshot_id,
      v_entry_count, v_review_count;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.dataset_staged_record staged
    LEFT JOIN dna.normalized_vault_staged_fact fact
      ON fact.owner_id = staged.owner_id
      AND fact.import_batch_id = staged.import_batch_id
      AND fact.source_row_number = staged.source_row_number
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND fact.source_row_number IS NULL
  ) THEN
    RAISE EXCEPTION 'ready Current Vault rows require normalized typed facts';
  END IF;

  SELECT accepted.result_status, accepted.activated_version_number
  INTO v_result_status, v_version_number
  FROM dna.accept_staged_dataset(
    p_import_batch_id,
    p_dataset_version_id,
    p_import_completed_at,
    p_activated_at,
    p_data_current_through
  ) accepted;

  IF v_result_status <> 'accepted' THEN
    RETURN QUERY SELECT v_result_status, v_version_number, NULL::uuid,
      0::bigint, 0::bigint;
    RETURN;
  END IF;

  SELECT data_current_through INTO v_effective_current_through
  FROM dna.dataset_version
  WHERE owner_id = v_owner_id AND id = p_dataset_version_id;

  v_snapshot_id := md5(
    v_owner_id::text || ':vault_snapshot:' || p_import_batch_id::text
  )::uuid;

  UPDATE dna.vault_snapshot
  SET is_current = false
  WHERE owner_id = v_owner_id AND is_current;

  INSERT INTO dna.vault_snapshot (
    id, owner_id, import_batch_id, captured_at, imported_at, is_current
  ) VALUES (
    v_snapshot_id, v_owner_id, p_import_batch_id,
    v_effective_current_through, p_import_completed_at, true
  );

  INSERT INTO dna.identity_review (
    id, owner_id, source_type, import_batch_id,
    raw_source_name, proposed_core_id, match_status
  )
  SELECT
    md5(
      v_owner_id::text || ':vault_identity_review:' ||
      p_import_batch_id::text || ':' || fact.source_row_number::text
    )::uuid,
    v_owner_id,
    'current_vault',
    p_import_batch_id,
    fact.display_name,
    CASE WHEN candidates.candidate_count = 1 THEN candidates.candidate_core_id END,
    CASE WHEN candidates.candidate_count = 0 THEN 'unmatched' ELSE 'ambiguous' END
  FROM dna.normalized_vault_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  CROSS JOIN LATERAL (
    SELECT
      count(*) AS candidate_count,
      (array_agg(core.id ORDER BY core.id))[1] AS candidate_core_id
    FROM dna.active_core_details core
    WHERE
      core.owner_id = v_owner_id
      AND lower(btrim(core.display_name)) = lower(btrim(fact.display_name))
      AND core.core_class = fact.core_class
      AND core.element = fact.element
      AND core.f_number = fact.f_number
      AND core.sex = fact.sex
  ) candidates
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready';

  INSERT INTO dna.vault_snapshot_entry (
    id, owner_id, vault_snapshot_id, source_row_number, source_record_key,
    raw_source_name, core_class, element, f_number, sex,
    maiden_state, maiden_source_value, identity_review_id, proposed_core_id
  )
  SELECT
    md5(v_snapshot_id::text || ':entry:' || fact.source_row_number::text)::uuid,
    v_owner_id,
    v_snapshot_id,
    fact.source_row_number,
    staged.natural_key,
    fact.display_name,
    fact.core_class,
    fact.element,
    fact.f_number,
    fact.sex,
    CASE
      WHEN fact.maiden_data_status = 'invalid' THEN 'invalid'
      WHEN fact.maiden_eligible IS TRUE THEN 'eligible'
      WHEN fact.maiden_eligible IS FALSE THEN 'not_eligible'
      ELSE 'unknown'
    END,
    fact.maiden_source_value,
    review.id,
    review.proposed_core_id
  FROM dna.normalized_vault_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  JOIN dna.identity_review review
    ON review.owner_id = fact.owner_id
    AND review.id = md5(
      v_owner_id::text || ':vault_identity_review:' ||
      p_import_batch_id::text || ':' || fact.source_row_number::text
    )::uuid
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready';

  SELECT count(*) INTO v_entry_count
  FROM dna.vault_snapshot_entry
  WHERE owner_id = v_owner_id AND vault_snapshot_id = v_snapshot_id;
  v_review_count := v_entry_count;

  RETURN QUERY SELECT v_result_status, v_version_number, v_snapshot_id,
    v_entry_count, v_review_count;
END
$function$;

CREATE FUNCTION dna.accept_staged_arena_dataset(
  p_import_batch_id uuid,
  p_dataset_version_id uuid,
  p_import_completed_at timestamptz,
  p_activated_at timestamptz,
  p_data_current_through timestamptz
)
RETURNS TABLE (
  result_status text,
  activated_version_number bigint,
  snapshot_id uuid,
  listing_count bigint,
  unresolved_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_batch dna.import_batch%ROWTYPE;
  v_result_status text;
  v_version_number bigint;
  v_snapshot_id uuid;
  v_listing_count bigint;
  v_unresolved_count bigint;
  v_effective_current_through timestamptz;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for Arena acceptance';
  END IF;

  SELECT * INTO v_batch
  FROM dna.import_batch
  WHERE owner_id = v_owner_id AND id = p_import_batch_id
  FOR UPDATE;

  IF v_batch.id IS NULL OR v_batch.source_type <> 'current_arena' THEN
    RAISE EXCEPTION 'owner-scoped Current Arena import batch does not exist';
  END IF;

  IF v_batch.status = 'accepted' THEN
    SELECT version_number INTO v_version_number
    FROM dna.dataset_version
    WHERE owner_id = v_owner_id AND import_batch_id = p_import_batch_id;
    SELECT id INTO v_snapshot_id
    FROM dna.arena_snapshot
    WHERE owner_id = v_owner_id AND import_batch_id = p_import_batch_id;
    SELECT count(*), count(*) FILTER (WHERE core_id IS NULL)
    INTO v_listing_count, v_unresolved_count
    FROM dna.arena_snapshot_entry
    WHERE owner_id = v_owner_id AND arena_snapshot_id = v_snapshot_id;
    RETURN QUERY SELECT 'idempotent'::text, v_version_number, v_snapshot_id,
      v_listing_count, v_unresolved_count;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.dataset_staged_record staged
    LEFT JOIN dna.normalized_arena_staged_fact fact
      ON fact.owner_id = staged.owner_id
      AND fact.import_batch_id = staged.import_batch_id
      AND fact.source_row_number = staged.source_row_number
    WHERE
      staged.owner_id = v_owner_id
      AND staged.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND fact.source_row_number IS NULL
  ) THEN
    RAISE EXCEPTION 'ready Current Arena rows require normalized typed facts';
  END IF;

  UPDATE dna.dataset_staged_record staged
  SET
    status = 'quarantined',
    issue_codes = CASE
      WHEN staged.issue_codes @> ARRAY['DUPLICATE_ARENA_CORE'] THEN staged.issue_codes
      ELSE array_append(staged.issue_codes, 'DUPLICATE_ARENA_CORE')
    END
  FROM dna.normalized_arena_staged_fact fact
  WHERE
    staged.owner_id = v_owner_id
    AND staged.import_batch_id = p_import_batch_id
    AND staged.status = 'ready'
    AND fact.owner_id = staged.owner_id
    AND fact.import_batch_id = staged.import_batch_id
    AND fact.source_row_number = staged.source_row_number
    AND EXISTS (
      SELECT 1
      FROM dna.normalized_arena_staged_fact other
      JOIN dna.dataset_staged_record other_staged
        ON other_staged.owner_id = other.owner_id
        AND other_staged.import_batch_id = other.import_batch_id
        AND other_staged.source_row_number = other.source_row_number
      WHERE
        other.owner_id = fact.owner_id
        AND other.import_batch_id = fact.import_batch_id
        AND other.source_core_id = fact.source_core_id
        AND other.source_row_number <> fact.source_row_number
        AND other_staged.status = 'ready'
    );

  SELECT accepted.result_status, accepted.activated_version_number
  INTO v_result_status, v_version_number
  FROM dna.accept_staged_dataset(
    p_import_batch_id,
    p_dataset_version_id,
    p_import_completed_at,
    p_activated_at,
    p_data_current_through
  ) accepted;

  IF v_result_status <> 'accepted' THEN
    RETURN QUERY SELECT v_result_status, v_version_number, NULL::uuid,
      0::bigint, 0::bigint;
    RETURN;
  END IF;

  SELECT data_current_through INTO v_effective_current_through
  FROM dna.dataset_version
  WHERE owner_id = v_owner_id AND id = p_dataset_version_id;

  v_snapshot_id := md5(
    v_owner_id::text || ':arena_snapshot:' || p_import_batch_id::text
  )::uuid;

  UPDATE dna.arena_snapshot
  SET is_current = false
  WHERE owner_id = v_owner_id AND is_current;

  INSERT INTO dna.arena_snapshot (
    id, owner_id, import_batch_id, captured_at, imported_at, is_current
  ) VALUES (
    v_snapshot_id, v_owner_id, p_import_batch_id,
    v_effective_current_through, p_import_completed_at, true
  );

  INSERT INTO dna.identity_review (
    id, owner_id, source_type, import_batch_id,
    raw_source_core_id, match_status
  )
  SELECT
    md5(
      v_owner_id::text || ':arena_identity_review:' ||
      p_import_batch_id::text || ':' || fact.source_row_number::text
    )::uuid,
    v_owner_id,
    'current_arena',
    p_import_batch_id,
    fact.source_core_id,
    'unmatched'
  FROM dna.normalized_arena_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  LEFT JOIN dna.active_core_details core
    ON core.owner_id = fact.owner_id
    AND core.source_core_id = fact.source_core_id
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready'
    AND core.id IS NULL;

  INSERT INTO dna.arena_snapshot_entry (
    id, owner_id, arena_snapshot_id, source_row_number,
    source_core_id, core_id, identity_review_id,
    price_usd_source_value, creates_economic_transaction
  )
  SELECT
    md5(v_snapshot_id::text || ':entry:' || fact.source_row_number::text)::uuid,
    v_owner_id,
    v_snapshot_id,
    fact.source_row_number,
    fact.source_core_id,
    core.id,
    review.id,
    fact.price_usd_source_value,
    false
  FROM dna.normalized_arena_staged_fact fact
  JOIN dna.dataset_staged_record staged
    ON staged.owner_id = fact.owner_id
    AND staged.import_batch_id = fact.import_batch_id
    AND staged.source_row_number = fact.source_row_number
  LEFT JOIN dna.active_core_details core
    ON core.owner_id = fact.owner_id
    AND core.source_core_id = fact.source_core_id
  LEFT JOIN dna.identity_review review
    ON review.owner_id = fact.owner_id
    AND review.id = md5(
      v_owner_id::text || ':arena_identity_review:' ||
      p_import_batch_id::text || ':' || fact.source_row_number::text
    )::uuid
  WHERE
    fact.owner_id = v_owner_id
    AND fact.import_batch_id = p_import_batch_id
    AND staged.status = 'ready';

  SELECT count(*), count(*) FILTER (WHERE core_id IS NULL)
  INTO v_listing_count, v_unresolved_count
  FROM dna.arena_snapshot_entry
  WHERE owner_id = v_owner_id AND arena_snapshot_id = v_snapshot_id;

  RETURN QUERY SELECT v_result_status, v_version_number, v_snapshot_id,
    v_listing_count, v_unresolved_count;
END
$function$;

ALTER FUNCTION dna.rollback_active_dataset(text, text, timestamptz)
  RENAME TO rollback_active_dataset_pre_snapshot;

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
  v_rolled_back_version bigint;
  v_restored_version bigint;
  v_restored_batch_id uuid;
BEGIN
  SELECT rollback.rolled_back_version_number, rollback.restored_version_number
  INTO v_rolled_back_version, v_restored_version
  FROM dna.rollback_active_dataset_pre_snapshot(
    p_source_type, p_reason, p_rolled_back_at
  ) rollback;

  IF p_source_type IN ('current_vault', 'current_arena') THEN
    SELECT import_batch_id INTO v_restored_batch_id
    FROM dna.dataset_version
    WHERE
      owner_id = v_owner_id
      AND source_type = p_source_type
      AND version_number = v_restored_version;
  END IF;

  IF p_source_type = 'current_vault' THEN
    UPDATE dna.vault_snapshot SET is_current = false
    WHERE owner_id = v_owner_id AND is_current;
    UPDATE dna.vault_snapshot SET is_current = true
    WHERE owner_id = v_owner_id AND import_batch_id = v_restored_batch_id;
  ELSIF p_source_type = 'current_arena' THEN
    UPDATE dna.arena_snapshot SET is_current = false
    WHERE owner_id = v_owner_id AND is_current;
    UPDATE dna.arena_snapshot SET is_current = true
    WHERE owner_id = v_owner_id AND import_batch_id = v_restored_batch_id;
  END IF;

  RETURN QUERY SELECT v_rolled_back_version, v_restored_version;
END
$function$;

REVOKE ALL ON TABLE dna.normalized_vault_staged_fact FROM PUBLIC;
REVOKE ALL ON TABLE dna.normalized_arena_staged_fact FROM PUBLIC;
REVOKE ALL ON TABLE dna.vault_snapshot_entry FROM PUBLIC;
REVOKE ALL ON TABLE dna.arena_snapshot_entry FROM PUBLIC;
REVOKE ALL ON TABLE dna.current_vault_snapshot_entry FROM PUBLIC;
REVOKE ALL ON TABLE dna.current_arena_snapshot_entry FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.accept_staged_vault_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.accept_staged_arena_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset_pre_snapshot(
  text, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.rollback_active_dataset(
  text, text, timestamptz
) FROM PUBLIC;

COMMIT;
