BEGIN;

CREATE TABLE dna.race_row_evidence_compaction_receipt (
  owner_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  source_row_count bigint NOT NULL CHECK (source_row_count > 0),
  evidence_kind text NOT NULL CHECK (
    evidence_kind IN ('staged_rows', 'normalized_partition')
  ),
  evidence_partition_count integer NOT NULL CHECK (
    evidence_partition_count BETWEEN 1 AND 10000
  ),
  evidence_byte_size bigint NOT NULL CHECK (evidence_byte_size > 0),
  deleted_source_provenance_count bigint NOT NULL CHECK (
    deleted_source_provenance_count >= 0
  ),
  deleted_version_record_count bigint NOT NULL CHECK (
    deleted_version_record_count >= 0
  ),
  compacted_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, import_batch_id),
  UNIQUE (owner_id, dataset_version_id),
  FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES dna.import_batch(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id) ON DELETE CASCADE
);

ALTER TABLE dna.race_row_evidence_compaction_receipt
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_row_evidence_compaction_receipt
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_row_evidence_compaction_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.suppress_race_merge_version_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.source_type = 'race_merge' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER suppress_race_merge_version_record
  BEFORE INSERT ON dna.dataset_version_record
  FOR EACH ROW
  EXECUTE FUNCTION dna.suppress_race_merge_version_record();

ALTER FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) RENAME TO accept_staged_race_dataset_pre_compact_replay;

CREATE FUNCTION dna.accept_staged_race_dataset(
  p_import_batch_id uuid,
  p_dataset_version_id uuid,
  p_import_completed_at timestamptz,
  p_activated_at timestamptz,
  p_data_current_through timestamptz
)
RETURNS TABLE (
  result_status text,
  activated_version_number bigint,
  materialized_event_count bigint,
  materialized_entry_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  v_result record;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for compact Race Merge replay';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.normalized_race_staged_fact fact
    JOIN dna.dataset_staged_record staged
      ON staged.owner_id = fact.owner_id
      AND staged.import_batch_id = fact.import_batch_id
      AND staged.source_row_number = fact.source_row_number
    JOIN dna.race_event event
      ON event.owner_id = fact.owner_id
      AND event.source_event_id = fact.source_event_id
    JOIN dna.race_entry entry
      ON entry.owner_id = event.owner_id
      AND entry.race_event_id = event.id
      AND entry.source_core_id = fact.source_core_id
    WHERE fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND entry.source_fingerprint_sha256 IS NULL
  ) THEN
    RAISE EXCEPTION 'existing Race Merge identity is missing its compact fingerprint';
  END IF;

  WITH conflicting_rows AS (
    SELECT DISTINCT staged.source_row_number
    FROM dna.normalized_race_staged_fact fact
    JOIN dna.dataset_staged_record staged
      ON staged.owner_id = fact.owner_id
      AND staged.import_batch_id = fact.import_batch_id
      AND staged.source_row_number = fact.source_row_number
    JOIN dna.race_event event
      ON event.owner_id = fact.owner_id
      AND event.source_event_id = fact.source_event_id
    JOIN dna.race_entry entry
      ON entry.owner_id = event.owner_id
      AND entry.race_event_id = event.id
      AND entry.source_core_id = fact.source_core_id
    WHERE fact.owner_id = v_owner_id
      AND fact.import_batch_id = p_import_batch_id
      AND staged.status = 'ready'
      AND entry.source_fingerprint_sha256 <>
        decode(staged.fingerprint_sha256, 'hex')
  )
  UPDATE dna.dataset_staged_record staged
  SET
    status = 'quarantined',
    issue_codes = CASE
      WHEN staged.issue_codes @> ARRAY['FINGERPRINT_CONFLICT']
        THEN staged.issue_codes
      ELSE array_append(staged.issue_codes, 'FINGERPRINT_CONFLICT')
    END
  FROM conflicting_rows conflict
  WHERE staged.owner_id = v_owner_id
    AND staged.import_batch_id = p_import_batch_id
    AND staged.source_row_number = conflict.source_row_number;

  SELECT * INTO STRICT v_result
  FROM dna.accept_staged_race_dataset_pre_compact_replay(
    p_import_batch_id,
    p_dataset_version_id,
    p_import_completed_at,
    p_activated_at,
    p_data_current_through
  );

  RETURN QUERY SELECT
    v_result.result_status,
    v_result.activated_version_number,
    v_result.materialized_event_count,
    v_result.materialized_entry_count;
END
$function$;

CREATE FUNCTION dna.compact_race_row_evidence(
  p_owner_id uuid,
  p_import_batch_id uuid,
  p_compacted_at timestamptz
)
RETURNS TABLE (
  status text,
  deleted_source_provenance_count bigint,
  deleted_version_record_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_batch dna.import_batch%ROWTYPE;
  v_version dna.dataset_version%ROWTYPE;
  v_evidence dna.dataset_version_evidence_receipt%ROWTYPE;
  v_receipt dna.race_row_evidence_compaction_receipt%ROWTYPE;
  v_deleted_source bigint := 0;
  v_deleted_version bigint := 0;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race Merge row evidence compaction denied';
  END IF;
  IF p_compacted_at IS NULL THEN
    RAISE EXCEPTION 'Race Merge row evidence compaction timestamp is required';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM dna.race_row_evidence_compaction_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.import_batch_id = p_import_batch_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT
      'existing'::text,
      v_receipt.deleted_source_provenance_count,
      v_receipt.deleted_version_record_count;
    RETURN;
  END IF;

  SELECT batch.* INTO v_batch
  FROM dna.import_batch batch
  WHERE batch.owner_id = p_owner_id
    AND batch.id = p_import_batch_id
  FOR UPDATE;

  IF NOT FOUND OR v_batch.source_type <> 'race_merge' THEN
    RAISE EXCEPTION 'owner-scoped accepted Race Merge batch does not exist';
  END IF;
  IF v_batch.status <> 'accepted' THEN
    RAISE EXCEPTION 'Race Merge row evidence compaction requires an accepted batch';
  END IF;
  IF v_batch.source_rows <= 0 THEN
    RAISE EXCEPTION 'Race Merge row evidence compaction requires source rows';
  END IF;

  SELECT version.* INTO v_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.import_batch_id = p_import_batch_id
    AND version.source_type = 'race_merge'
  FOR UPDATE;

  IF NOT FOUND OR v_version.rolled_back_at IS NOT NULL THEN
    RAISE EXCEPTION 'unrolled Race Merge dataset version is unavailable';
  END IF;
  IF v_version.aggregate_refreshed_at IS NULL OR NOT EXISTS (
    SELECT 1
    FROM dna.aggregate_refresh_job job
    WHERE job.owner_id = p_owner_id
      AND job.dataset_version_id = v_version.id
      AND job.status = 'completed'
      AND job.completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Race Merge analytical read models are not complete';
  END IF;

  SELECT evidence.* INTO v_evidence
  FROM dna.dataset_version_evidence_receipt evidence
  WHERE evidence.owner_id = p_owner_id
    AND evidence.dataset_version_id = v_version.id
    AND evidence.import_batch_id = p_import_batch_id
    AND evidence.source_type = 'race_merge'
  FOR UPDATE;

  IF NOT FOUND
     OR v_evidence.evidence_row_count <> v_batch.source_rows
     OR v_evidence.evidence_partition_count < 1
     OR v_evidence.evidence_byte_size <= 0 THEN
    RAISE EXCEPTION 'sealed Race Merge evidence coverage is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.dataset_evidence_compaction_receipt receipt
    WHERE receipt.owner_id = p_owner_id
      AND receipt.import_batch_id = p_import_batch_id
      AND receipt.source_type = 'race_merge'
      AND receipt.source_row_count = v_batch.source_rows
      AND receipt.evidence_row_count = v_batch.source_rows
  ) THEN
    RAISE EXCEPTION 'transient Race Merge evidence compaction is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    JOIN dna.race_entry_source source
      ON source.owner_id = entry.owner_id
      AND source.race_entry_id = entry.id
      AND source.import_batch_id = p_import_batch_id
    WHERE entry.owner_id = p_owner_id
      AND source.is_selected_fact
      AND entry.source_fingerprint_sha256 IS NULL
  ) THEN
    RAISE EXCEPTION 'Race Merge source provenance cannot be removed before identity binding';
  END IF;

  WITH deleted AS (
    DELETE FROM dna.race_entry_source source
    WHERE source.owner_id = p_owner_id
      AND source.import_batch_id = p_import_batch_id
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_source FROM deleted;

  WITH deleted AS (
    DELETE FROM dna.dataset_version_record record
    WHERE record.owner_id = p_owner_id
      AND record.dataset_version_id = v_version.id
      AND record.source_type = 'race_merge'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_version FROM deleted;

  INSERT INTO dna.race_row_evidence_compaction_receipt (
    owner_id,
    import_batch_id,
    dataset_version_id,
    source_row_count,
    evidence_kind,
    evidence_partition_count,
    evidence_byte_size,
    deleted_source_provenance_count,
    deleted_version_record_count,
    compacted_at
  ) VALUES (
    p_owner_id,
    p_import_batch_id,
    v_version.id,
    v_batch.source_rows,
    v_evidence.evidence_kind,
    v_evidence.evidence_partition_count,
    v_evidence.evidence_byte_size,
    v_deleted_source,
    v_deleted_version,
    p_compacted_at
  );

  RETURN QUERY SELECT 'compacted'::text, v_deleted_source, v_deleted_version;
END
$function$;

REVOKE ALL ON TABLE dna.race_row_evidence_compaction_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.suppress_race_merge_version_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.accept_staged_race_dataset_pre_compact_replay(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.compact_race_row_evidence(
  uuid, uuid, timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.race_row_evidence_compaction_receipt TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.accept_staged_race_dataset(
  uuid, uuid, timestamptz, timestamptz, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.compact_race_row_evidence(
  uuid, uuid, timestamptz
) TO dna_app_runtime;

COMMIT;
