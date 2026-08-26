BEGIN;

CREATE TABLE dna.race_entry_archive_compaction_receipt (
  owner_id uuid NOT NULL,
  refresh_id uuid NOT NULL,
  race_dataset_version_id uuid NOT NULL,
  source_version_set_sha256 character(64) NOT NULL CHECK (
    source_version_set_sha256 ~ '^[a-f0-9]{64}$'
  ),
  deleted_entry_count bigint NOT NULL CHECK (deleted_entry_count >= 0),
  preserved_event_count bigint NOT NULL CHECK (preserved_event_count >= 0),
  compacted_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, refresh_id),
  FOREIGN KEY (owner_id, refresh_id)
    REFERENCES dna.race_archive_aggregate_publication_receipt(owner_id, refresh_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, race_dataset_version_id)
    REFERENCES dna.dataset_version(owner_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE dna.race_entry_archive_compaction_receipt
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.race_entry_archive_compaction_receipt
  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.race_entry_archive_compaction_receipt
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.compact_published_race_entries(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_compacted_at timestamptz
)
RETURNS TABLE (
  status text,
  deleted_entry_count bigint,
  preserved_event_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing dna.race_entry_archive_compaction_receipt%ROWTYPE;
  v_publication dna.race_archive_aggregate_publication_receipt%ROWTYPE;
  v_race_version dna.dataset_version%ROWTYPE;
  v_deleted_entry_count bigint := 0;
  v_preserved_event_count bigint := 0;
  v_performance_count bigint;
  v_discovery_count bigint;
  v_payout_count bigint;
  v_star_count bigint;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Race entry archive compaction denied';
  END IF;
  IF p_compacted_at IS NULL THEN
    RAISE EXCEPTION 'Race entry archive compaction timestamp is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_owner_id::text || ':race-entry-archive-compaction', 0)
  );

  SELECT receipt.* INTO v_existing
  FROM dna.race_entry_archive_compaction_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.refresh_id = p_refresh_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT
      'existing'::text,
      v_existing.deleted_entry_count,
      v_existing.preserved_event_count;
    RETURN;
  END IF;

  SELECT receipt.* INTO v_publication
  FROM dna.race_archive_aggregate_publication_receipt receipt
  WHERE receipt.owner_id = p_owner_id
    AND receipt.refresh_id = p_refresh_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'published Race archive aggregate receipt is unavailable';
  END IF;
  IF v_publication.target_dataset_version_id <>
       v_publication.race_dataset_version_id THEN
    RAISE EXCEPTION 'Race entry compaction requires a Race Merge target publication';
  END IF;
  IF p_compacted_at < v_publication.published_at THEN
    RAISE EXCEPTION 'Race entry compaction cannot predate archive publication';
  END IF;

  SELECT version.* INTO v_race_version
  FROM dna.dataset_version version
  WHERE version.owner_id = p_owner_id
    AND version.id = v_publication.race_dataset_version_id
    AND version.source_type = 'race_merge'
    AND version.is_active
    AND version.rolled_back_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active published Race Merge version is unavailable';
  END IF;
  IF dna.active_pro_league_source_version_set_sha256(p_owner_id)
       <> v_publication.source_version_set_sha256 THEN
    RAISE EXCEPTION 'published Race archive source versions were superseded';
  END IF;

  SELECT count(*)::bigint INTO v_performance_count
  FROM dna.core_performance_profile profile
  WHERE profile.owner_id = p_owner_id;
  SELECT count(*)::bigint INTO v_discovery_count
  FROM dna.discovery_exact_distance_benchmark benchmark
  WHERE benchmark.owner_id = p_owner_id;
  SELECT count(*)::bigint INTO v_payout_count
  FROM dna.core_payout_format_profile profile
  WHERE profile.owner_id = p_owner_id;
  SELECT count(*)::bigint INTO v_star_count
  FROM dna.core_star_profile profile
  WHERE profile.owner_id = p_owner_id;

  IF v_performance_count <> v_publication.core_performance_profile_count
     OR v_discovery_count <> v_publication.discovery_benchmark_count
     OR v_payout_count <> v_publication.payout_format_profile_count
     OR v_star_count <> v_publication.core_star_profile_count
     OR EXISTS (
       SELECT 1 FROM dna.core_performance_profile profile
       WHERE profile.owner_id = p_owner_id
         AND profile.refreshed_at <> v_publication.refreshed_at
     )
     OR EXISTS (
       SELECT 1 FROM dna.discovery_exact_distance_benchmark benchmark
       WHERE benchmark.owner_id = p_owner_id
         AND benchmark.refreshed_at <> v_publication.refreshed_at
     )
     OR EXISTS (
       SELECT 1 FROM dna.core_payout_format_profile profile
       WHERE profile.owner_id = p_owner_id
         AND profile.refreshed_at <> v_publication.refreshed_at
     )
     OR EXISTS (
       SELECT 1 FROM dna.core_star_profile profile
       WHERE profile.owner_id = p_owner_id
         AND profile.refreshed_at <> v_publication.refreshed_at
     ) THEN
    RAISE EXCEPTION 'Race archive read models do not match their publication receipt';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.dataset_version version
    JOIN dna.import_batch batch
      ON batch.owner_id = version.owner_id
      AND batch.id = version.import_batch_id
      AND batch.source_type = 'race_merge'
    LEFT JOIN dna.dataset_version_evidence_receipt evidence
      ON evidence.owner_id = version.owner_id
      AND evidence.dataset_version_id = version.id
      AND evidence.import_batch_id = version.import_batch_id
      AND evidence.source_type = 'race_merge'
    LEFT JOIN dna.race_archive_core_locator_receipt locator
      ON locator.owner_id = version.owner_id
      AND locator.dataset_version_id = version.id
      AND locator.import_batch_id = version.import_batch_id
    LEFT JOIN dna.dataset_evidence_compaction_receipt evidence_compaction
      ON evidence_compaction.owner_id = version.owner_id
      AND evidence_compaction.import_batch_id = version.import_batch_id
      AND evidence_compaction.source_type = 'race_merge'
    LEFT JOIN dna.race_row_evidence_compaction_receipt row_compaction
      ON row_compaction.owner_id = version.owner_id
      AND row_compaction.dataset_version_id = version.id
      AND row_compaction.import_batch_id = version.import_batch_id
    WHERE version.owner_id = p_owner_id
      AND version.source_type = 'race_merge'
      AND version.rolled_back_at IS NULL
      AND version.version_number <= v_race_version.version_number
      AND (
        batch.status <> 'accepted'
        OR evidence.dataset_version_id IS NULL
        OR evidence.evidence_kind <> 'staged_rows'
        OR evidence.evidence_row_count <> batch.source_rows
        OR evidence.evidence_partition_count NOT BETWEEN 1 AND 10000
        OR evidence.evidence_byte_size <= 0
        OR locator.dataset_version_id IS NULL
        OR locator.ready_row_count <> batch.accepted_rows
        OR evidence_compaction.import_batch_id IS NULL
        OR evidence_compaction.source_row_count <> batch.source_rows
        OR evidence_compaction.evidence_row_count <> batch.source_rows
        OR row_compaction.dataset_version_id IS NULL
        OR row_compaction.source_row_count <> batch.source_rows
      )
  ) THEN
    RAISE EXCEPTION 'complete sealed Race archive compaction prerequisites are unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.owner_id = p_owner_id
      AND entry.active_in_dataset
      AND entry.source_fingerprint_sha256 IS NULL
  ) THEN
    RAISE EXCEPTION 'active Race entry archive identity is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.race_entry_source source
    JOIN dna.race_entry entry
      ON entry.owner_id = source.owner_id
      AND entry.id = source.race_entry_id
    WHERE entry.owner_id = p_owner_id
      AND entry.active_in_dataset
  ) THEN
    RAISE EXCEPTION 'active Race entry provenance is not compacted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.contype = 'f'
      AND constraint_record.confrelid = 'dna.race_entry'::regclass
      AND constraint_record.conrelid <> 'dna.race_entry_source'::regclass
  ) THEN
    RAISE EXCEPTION 'Race entry still has a durable foreign-key dependent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.economic_transaction transaction
    WHERE transaction.owner_id = p_owner_id
      AND transaction.source_type = 'race_derived'
      AND (
        transaction.race_entry_id IS NULL
        OR NULLIF(btrim(transaction.race_source_event_id), '') IS NULL
        OR NULLIF(btrim(transaction.race_source_core_id), '') IS NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM dna.race_economic_contribution contribution
    WHERE contribution.owner_id = p_owner_id
      AND (
        NULLIF(btrim(contribution.race_source_event_id), '') IS NULL
        OR NULLIF(btrim(contribution.race_source_core_id), '') IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'Race economic archive identity is incomplete';
  END IF;

  SELECT count(*)::bigint INTO v_preserved_event_count
  FROM dna.race_event event
  WHERE event.owner_id = p_owner_id
    AND event.active_in_dataset;

  WITH deleted AS (
    DELETE FROM dna.race_entry entry
    WHERE entry.owner_id = p_owner_id
      AND entry.active_in_dataset
    RETURNING 1
  )
  SELECT count(*)::bigint INTO v_deleted_entry_count FROM deleted;

  IF EXISTS (
    SELECT 1
    FROM dna.race_entry entry
    WHERE entry.owner_id = p_owner_id
      AND entry.active_in_dataset
  ) THEN
    RAISE EXCEPTION 'active Race entries remain after archive compaction';
  END IF;

  INSERT INTO dna.race_entry_archive_compaction_receipt (
    owner_id,
    refresh_id,
    race_dataset_version_id,
    source_version_set_sha256,
    deleted_entry_count,
    preserved_event_count,
    compacted_at
  ) VALUES (
    p_owner_id,
    p_refresh_id,
    v_publication.race_dataset_version_id,
    v_publication.source_version_set_sha256,
    v_deleted_entry_count,
    v_preserved_event_count,
    p_compacted_at
  );

  RETURN QUERY SELECT
    'compacted'::text,
    v_deleted_entry_count,
    v_preserved_event_count;
END
$function$;

ALTER FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) RENAME TO publish_pro_league_aggregate_refresh_pre_entry_compact;

REVOKE ALL ON FUNCTION dna.publish_pro_league_aggregate_refresh_pre_entry_compact(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_pro_league_aggregate_refresh_pre_entry_compact(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) FROM dna_app_runtime;

CREATE FUNCTION dna.publish_pro_league_aggregate_refresh(
  p_owner_id uuid,
  p_refresh_id uuid,
  p_dataset_version_id uuid,
  p_worker_id text,
  p_prepared_aggregate_set_id uuid,
  p_source_version_set_sha256 character(64),
  p_aggregate_family_count integer,
  p_materialized_row_count bigint,
  p_completed_at timestamptz
)
RETURNS TABLE (status text, aggregate_set_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_result record;
  v_source_type text;
  v_compaction_status text;
BEGIN
  SELECT * INTO STRICT v_result
  FROM dna.publish_pro_league_aggregate_refresh_pre_entry_compact(
    p_owner_id,
    p_refresh_id,
    p_dataset_version_id,
    p_worker_id,
    p_prepared_aggregate_set_id,
    p_source_version_set_sha256,
    p_aggregate_family_count,
    p_materialized_row_count,
    p_completed_at
  );

  IF v_result.status = 'published' THEN
    SELECT version.source_type INTO STRICT v_source_type
    FROM dna.dataset_version version
    WHERE version.owner_id = p_owner_id
      AND version.id = p_dataset_version_id;

    IF v_source_type = 'race_merge' THEN
      SELECT compact.status INTO STRICT v_compaction_status
      FROM dna.compact_published_race_entries(
        p_owner_id,
        p_refresh_id,
        p_completed_at
      ) compact;

      IF v_compaction_status NOT IN ('compacted', 'existing') THEN
        RAISE EXCEPTION 'Race entry archive compaction did not complete';
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_result.status::text,
    v_result.aggregate_set_id::uuid;
END
$function$;

REVOKE ALL ON TABLE dna.race_entry_archive_compaction_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.compact_published_race_entries(
  uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) FROM PUBLIC;

GRANT SELECT ON TABLE dna.race_entry_archive_compaction_receipt TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.compact_published_race_entries(
  uuid, uuid, timestamptz
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.publish_pro_league_aggregate_refresh(
  uuid, uuid, uuid, text, uuid, character, integer, bigint, timestamptz
) TO dna_app_runtime;

COMMENT ON FUNCTION dna.compact_published_race_entries(
  uuid, uuid, timestamptz
) IS
  'Removes only active normalized Race entry detail after exact archive publication, sealed R2 evidence, Core locators, prior provenance compaction, archive identity, and current read-model parity are all proven. Race events remain durable for star/reconciliation identity.';

COMMIT;
