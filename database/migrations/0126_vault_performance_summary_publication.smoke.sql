BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('91260000-0000-4000-8000-000000000001', 'smoke_summary_publication_owner'),
  ('91260000-0000-4000-8000-000000000002', 'smoke_summary_publication_other');

INSERT INTO dna.asset_currency(
  id, owner_id, code, display_name, asset_kind, atomic_scale
) VALUES (
  '91260000-0000-4000-8000-000000000010',
  '91260000-0000-4000-8000-000000000001',
  'DEZ', 'DEZ', 'game_token', 6
);

INSERT INTO dna.import_batch(
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  import_completed_at, minimum_accepted_event_at,
  maximum_accepted_event_at, dataset_current_through_after_import,
  source_rows, accepted_rows, rejected_rows, warning_rows
) VALUES (
  '91260000-0000-4000-8000-000000000020',
  '91260000-0000-4000-8000-000000000001',
  'manual_economic', 'synthetic-private-fixture', repeat('c',64),
  'utf_8', 'synthetic-v1', 'accepted', '2026-10-15T01:00:00Z',
  '2026-10-15T02:00:00Z', NULL, NULL, '2026-10-15T01:30:00Z',
  1, 1, 0, 0
);

INSERT INTO dna.economic_transaction(
  id, owner_id, natural_key, source_type, import_batch_id,
  asset_currency_id, occurred_at, amount_atomic, direction, category,
  operating_effect, classification_status, duplicate_status
) VALUES (
  '91260000-0000-4000-8000-000000000030',
  '91260000-0000-4000-8000-000000000001',
  'synthetic-publication-payout', 'manual',
  '91260000-0000-4000-8000-000000000020',
  '91260000-0000-4000-8000-000000000010',
  '2026-10-15T01:15:00Z', 1234567, 'credit', 'open_race_payout',
  true, 'manual', 'clear'
);

DO $metadata$
DECLARE
  v_privilege text;
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_class
    WHERE oid='dna.vault_performance_summary_source_state'::regclass)
  THEN
    RAISE EXCEPTION 'forced source-state isolation missing';
  END IF;
  FOREACH v_privilege IN ARRAY ARRAY[
    'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
  ] LOOP
    IF has_table_privilege(
      'dna_app_runtime',
      'dna.vault_performance_summary_source_state',
      v_privilege
    ) THEN
      RAISE EXCEPTION 'runtime source-state table privilege unexpectedly present';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('dna_app_runtime',
    'dna.read_vault_performance_canonical_source(uuid)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
    'dna.claim_vault_performance_source_identity(uuid,bigint,text)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
    'dna.read_vault_performance_source_identity(uuid)','EXECUTE')
    OR NOT has_function_privilege('dna_app_runtime',
    'dna.publish_vault_performance_summary_snapshot(uuid,text,timestamptz,text,text)',
    'EXECUTE')
  THEN
    RAISE EXCEPTION 'runtime publication function permission missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc proc, LATERAL aclexplode(proc.proacl) acl
    WHERE proc.oid IN (
      'dna.read_vault_performance_canonical_source(uuid)'::regprocedure,
      'dna.claim_vault_performance_source_identity(uuid,bigint,text)'::regprocedure,
      'dna.read_vault_performance_source_identity(uuid)'::regprocedure,
      'dna.publish_vault_performance_summary_snapshot(uuid,text,timestamptz,text,text)'::regprocedure
    ) AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
  ) THEN
    RAISE EXCEPTION 'public Vault Performance publication permission present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc proc
    WHERE proc.oid IN (
      'dna.read_vault_performance_canonical_source(uuid)'::regprocedure,
      'dna.claim_vault_performance_source_identity(uuid,bigint,text)'::regprocedure,
      'dna.read_vault_performance_source_identity(uuid)'::regprocedure,
      'dna.publish_vault_performance_summary_snapshot(uuid,text,timestamptz,text,text)'::regprocedure
    ) AND (NOT proc.prosecdef OR
      NOT proc.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'])
  ) THEN
    RAISE EXCEPTION 'Vault Performance publication function configuration unsafe';
  END IF;
END
$metadata$;

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91260000-0000-4000-8000-000000000001';

DO $runtime$
DECLARE
  v_source record;
  v_body text;
  v_sha text;
  v_status text;
BEGIN
  SELECT * INTO v_source
  FROM dna.read_vault_performance_canonical_source(
    '91260000-0000-4000-8000-000000000001'
  );
  IF v_source.source_revision <> 3
    OR jsonb_array_length(v_source.records_json) <> 1
    OR v_source.records_json->0->>'signedAmount' <> '1.234567'
    OR v_source.records_json->0->>'category' <> 'open_race_payout'
    OR v_source.coverage_json->>'sourceCoverage' <> 'unknown'
    OR v_source.coverage_json->>'manualTournamentPayoutStatus' <> 'unknown'
    OR v_source.unsupported_count <> 0
  THEN
    RAISE EXCEPTION 'canonical Vault Performance source mapping failed';
  END IF;

  IF NOT dna.claim_vault_performance_source_identity(
    '91260000-0000-4000-8000-000000000001', 3, repeat('a',64)
  ) THEN
    RAISE EXCEPTION 'source identity claim failed';
  END IF;
  IF (SELECT source_ledger_sha256
    FROM dna.read_vault_performance_source_identity(
      '91260000-0000-4000-8000-000000000001'
    )) <> repeat('a',64)
  THEN
    RAISE EXCEPTION 'compact source identity read failed';
  END IF;

  v_body := jsonb_build_object(
    'version',1,
    'databaseOwnerId','91260000-0000-4000-8000-000000000001',
    'sourceLedgerSha256',repeat('a',64),
    'materializedAt','2026-10-15T03:00:00.000Z',
    'summary','{}'::jsonb
  )::text;
  v_sha := encode(sha256(convert_to(v_body,'UTF8')),'hex');
  v_status := dna.publish_vault_performance_summary_snapshot(
    '91260000-0000-4000-8000-000000000001', repeat('a',64),
    '2026-10-15T03:00:00Z', v_body, v_sha
  );
  IF v_status <> 'published' THEN
    RAISE EXCEPTION 'source-bound summary was not published';
  END IF;
  v_status := dna.publish_vault_performance_summary_snapshot(
    '91260000-0000-4000-8000-000000000001', repeat('a',64),
    '2026-10-15T03:00:00Z', v_body, v_sha
  );
  IF v_status <> 'unchanged' THEN
    RAISE EXCEPTION 'idempotent summary retry was not unchanged';
  END IF;

  BEGIN
    PERFORM * FROM dna.read_vault_performance_canonical_source(
      '91260000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'cross-owner canonical source read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='cross-owner canonical source read accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM dna.vault_performance_summary_source_state;
    RAISE EXCEPTION 'direct runtime source-state read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$runtime$;

RESET ROLE;

-- A correction invalidates the compact identity before any successor summary
-- can replace last-good. The stored prior snapshot remains intact but cannot
-- match a current source until a fresh claim/publication succeeds.
UPDATE dna.economic_transaction
SET amount_atomic = 1234568,
  updated_at = '2026-10-15T03:05:00Z'
WHERE owner_id = '91260000-0000-4000-8000-000000000001'
  AND id = '91260000-0000-4000-8000-000000000030';

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91260000-0000-4000-8000-000000000001';

DO $invalidation$
DECLARE
  v_status text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM dna.read_vault_performance_source_identity(
      '91260000-0000-4000-8000-000000000001'
    )
  ) THEN
    RAISE EXCEPTION 'corrected source retained an accepted identity';
  END IF;
  IF dna.claim_vault_performance_source_identity(
    '91260000-0000-4000-8000-000000000001', 3, repeat('b',64)
  ) THEN
    RAISE EXCEPTION 'stale source revision was claimed';
  END IF;
  v_status := dna.publish_vault_performance_summary_snapshot(
    '91260000-0000-4000-8000-000000000001', repeat('a',64),
    '2026-10-15T03:10:00Z', '{}', repeat('b',64)
  );
  IF v_status <> 'source_changed' THEN
    RAISE EXCEPTION 'superseded source did not preserve last-good';
  END IF;
END
$invalidation$;

RESET ROLE;

DO $last_good$
BEGIN
  IF (SELECT count(*) FROM dna.vault_performance_summary_snapshot
    WHERE owner_id='91260000-0000-4000-8000-000000000001'
      AND source_ledger_sha256=repeat('a',64)) <> 1
  THEN
    RAISE EXCEPTION 'source correction destroyed the stored last-good summary';
  END IF;
  IF (SELECT source_revision FROM dna.vault_performance_summary_source_state
    WHERE owner_id='91260000-0000-4000-8000-000000000001') <> 4
  THEN
    RAISE EXCEPTION 'source correction did not advance revision';
  END IF;
END
$last_good$;

ROLLBACK;
