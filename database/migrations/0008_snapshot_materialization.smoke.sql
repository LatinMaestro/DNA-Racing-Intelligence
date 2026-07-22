BEGIN;

SET LOCAL app.owner_id = '80000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('80000000-0000-4000-8000-000000000001', 'synthetic_snapshot_owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at, import_completed_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES
  (
    '80000000-0000-4000-8000-000000000010',
    '80000000-0000-4000-8000-000000000001',
    'core_details', 'synthetic-core-reference.csv', repeat('0', 64),
    'utf_8', 'core-details/v1', 'accepted',
    '2026-07-23T08:00:00Z', '2026-07-23T08:01:00Z', 2, 2, 0, 0
  ),
  (
    '80000000-0000-4000-8000-000000000101',
    '80000000-0000-4000-8000-000000000001',
    'current_vault', 'synthetic-vault-v1.csv', repeat('1', 64),
    'utf_8', 'current-vault/v1', 'validating',
    '2026-07-23T08:10:00Z', NULL, 2, 0, 2, 0
  ),
  (
    '80000000-0000-4000-8000-000000000102',
    '80000000-0000-4000-8000-000000000001',
    'current_vault', 'synthetic-vault-v2.csv', repeat('2', 64),
    'utf_8', 'current-vault/v1', 'validating',
    '2026-07-23T08:20:00Z', NULL, 1, 0, 1, 0
  ),
  (
    '80000000-0000-4000-8000-000000000201',
    '80000000-0000-4000-8000-000000000001',
    'current_arena', 'synthetic-arena-v1.csv', repeat('3', 64),
    'utf_8', 'current-arena/v1', 'validating',
    '2026-07-23T08:30:00Z', NULL, 2, 0, 2, 0
  ),
  (
    '80000000-0000-4000-8000-000000000202',
    '80000000-0000-4000-8000-000000000001',
    'current_arena', 'synthetic-arena-v2.csv', repeat('4', 64),
    'utf_8', 'current-arena/v1', 'validating',
    '2026-07-23T08:40:00Z', NULL, 1, 0, 1, 0
  );

INSERT INTO dna.core (
  id, owner_id, source_core_id, display_name, core_class,
  element, f_number, sex, source_import_batch_id
)
VALUES
  (
    '80000000-0000-4000-8000-000000000011',
    '80000000-0000-4000-8000-000000000001',
    'core-alpha', 'Synthetic Alpha', 'Genesis', 'Fire', 1, 'female',
    '80000000-0000-4000-8000-000000000010'
  ),
  (
    '80000000-0000-4000-8000-000000000012',
    '80000000-0000-4000-8000-000000000001',
    'core-beta', 'Synthetic Beta', 'Morphed', 'Water', 2, 'male',
    '80000000-0000-4000-8000-000000000010'
  );

INSERT INTO dna.core_import_provenance (
  id, owner_id, core_id, import_batch_id, source_row_number,
  raw_source_core_id, raw_source_name, is_selected_fact
)
VALUES
  (
    '80000000-0000-4000-8000-000000000021',
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000011',
    '80000000-0000-4000-8000-000000000010', 1,
    'core-alpha', 'Synthetic Alpha', true
  ),
  (
    '80000000-0000-4000-8000-000000000022',
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000012',
    '80000000-0000-4000-8000-000000000010', 2,
    'core-beta', 'Synthetic Beta', true
  );

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number,
  natural_key, fingerprint_sha256, status
)
VALUES
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000101', 1, 'vault-row-1', repeat('a', 64), 'ready'),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000101', 2, 'vault-row-2', repeat('b', 64), 'ready'),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000102', 1, 'vault-row-1', repeat('c', 64), 'ready'),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000201', 1, 'arena|core-beta', repeat('d', 64), 'ready'),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000201', 2, 'arena|core-ghost', repeat('e', 64), 'ready'),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000202', 1, 'arena|core-beta', repeat('f', 64), 'ready');

INSERT INTO dna.normalized_vault_staged_fact (
  owner_id, import_batch_id, source_row_number,
  display_name, core_class, element, f_number, sex,
  maiden_eligible, maiden_source_value, maiden_data_status
)
VALUES
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000101', 1, 'Synthetic Alpha', 'Genesis', 'Fire', 1, 'female', true, 'TRUE', 'valid'),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000101', 2, 'Synthetic Unknown', 'Freak', 'Earth', 3, 'male', NULL, '', 'missing'),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000102', 1, 'Synthetic Alpha', 'Genesis', 'Fire', 1, 'female', false, 'false', 'valid');

INSERT INTO dna.normalized_arena_staged_fact (
  owner_id, import_batch_id, source_row_number,
  source_core_id, price_usd_source_value, creates_economic_transaction
)
VALUES
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000201', 1, 'core-beta', '125.00', false),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000201', 2, 'core-ghost', '0.50', false),
  ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000202', 1, 'core-beta', '150.000', false);

SELECT * FROM dna.accept_staged_vault_dataset(
  '80000000-0000-4000-8000-000000000101',
  '80000000-0000-4000-8000-000000000301',
  '2026-07-23T08:11:00Z', '2026-07-23T08:12:00Z',
  '2026-07-23T08:05:00Z'
);

DO $vault_v1_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.current_vault_snapshot_entry) <> 2
    OR (SELECT count(*) FROM dna.vault_snapshot WHERE is_current) <> 1
    OR (SELECT count(*) FROM dna.identity_review WHERE source_type = 'current_vault') <> 2
  THEN
    RAISE EXCEPTION 'Current Vault v1 did not materialize exactly';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.current_vault_snapshot_entry
    WHERE
      raw_source_name = 'Synthetic Alpha'
      AND maiden_state = 'eligible'
      AND proposed_core_id = '80000000-0000-4000-8000-000000000011'
  ) OR EXISTS (
    SELECT 1
    FROM dna.identity_review
    WHERE source_type = 'current_vault' AND match_status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Vault candidates were auto-confirmed or lost';
  END IF;
END
$vault_v1_assertions$;

SELECT * FROM dna.accept_staged_vault_dataset(
  '80000000-0000-4000-8000-000000000102',
  '80000000-0000-4000-8000-000000000302',
  '2026-07-23T08:21:00Z', '2026-07-23T08:22:00Z',
  '2026-07-23T08:15:00Z'
);

DO $vault_v2_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.current_vault_snapshot_entry) <> 1
    OR (SELECT count(*) FROM dna.vault_snapshot) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM dna.current_vault_snapshot_entry
      WHERE maiden_state = 'not_eligible'
    )
  THEN
    RAISE EXCEPTION 'Current Vault snapshot replacement failed';
  END IF;
END
$vault_v2_assertions$;

SELECT * FROM dna.rollback_active_dataset(
  'current_vault', 'synthetic Vault rollback', '2026-07-23T08:25:00Z'
);

DO $vault_rollback_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.current_vault_snapshot_entry) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM dna.current_vault_snapshot_entry
      WHERE raw_source_name = 'Synthetic Unknown' AND maiden_state = 'unknown'
    )
  THEN
    RAISE EXCEPTION 'Current Vault rollback did not restore v1';
  END IF;
END
$vault_rollback_assertions$;

SELECT * FROM dna.accept_staged_arena_dataset(
  '80000000-0000-4000-8000-000000000201',
  '80000000-0000-4000-8000-000000000401',
  '2026-07-23T08:31:00Z', '2026-07-23T08:32:00Z',
  '2026-07-23T08:25:00Z'
);

DO $arena_v1_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.current_arena_snapshot_entry) <> 2
    OR (SELECT count(*) FROM dna.economic_transaction) <> 0
    OR NOT EXISTS (
      SELECT 1 FROM dna.current_arena_snapshot_entry
      WHERE
        source_core_id = 'core-beta'
        AND core_id = '80000000-0000-4000-8000-000000000012'
        AND price_usd_source_value = '125.00'
        AND NOT creates_economic_transaction
    )
    OR NOT EXISTS (
      SELECT 1 FROM dna.current_arena_snapshot_entry entry
      JOIN dna.identity_review review
        ON review.owner_id = entry.owner_id
        AND review.id = entry.identity_review_id
      WHERE
        entry.source_core_id = 'core-ghost'
        AND entry.core_id IS NULL
        AND review.match_status = 'unmatched'
    )
  THEN
    RAISE EXCEPTION 'Current Arena exact or unresolved identity handling failed';
  END IF;
END
$arena_v1_assertions$;

SELECT * FROM dna.accept_staged_arena_dataset(
  '80000000-0000-4000-8000-000000000202',
  '80000000-0000-4000-8000-000000000402',
  '2026-07-23T08:41:00Z', '2026-07-23T08:42:00Z',
  '2026-07-23T08:35:00Z'
);

DO $arena_v2_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.current_arena_snapshot_entry) <> 1
    OR (SELECT count(*) FROM dna.arena_snapshot) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM dna.current_arena_snapshot_entry
      WHERE price_usd_source_value = '150.000'
    )
    OR (SELECT count(*) FROM dna.economic_transaction) <> 0
  THEN
    RAISE EXCEPTION 'Current Arena replacement created false economics or failed';
  END IF;
END
$arena_v2_assertions$;

SELECT * FROM dna.rollback_active_dataset(
  'current_arena', 'synthetic Arena rollback', '2026-07-23T08:45:00Z'
);

DO $arena_rollback_and_security_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.current_arena_snapshot_entry) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM dna.current_arena_snapshot_entry
      WHERE source_core_id = 'core-beta' AND price_usd_source_value = '125.00'
    )
  THEN
    RAISE EXCEPTION 'Current Arena rollback did not restore v1';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc proc
    JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(proc.proacl, acldefault('f', proc.proowner))
    ) acl
    WHERE
      namespace.nspname = 'dna'
      AND proc.proname IN (
        'accept_staged_vault_dataset',
        'accept_staged_arena_dataset',
        'rollback_active_dataset_pre_snapshot'
      )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Snapshot materialization functions are executable by PUBLIC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE
      namespace.nspname = 'dna'
      AND relation.relname IN (
        'normalized_vault_staged_fact',
        'normalized_arena_staged_fact',
        'vault_snapshot_entry',
        'arena_snapshot_entry'
      )
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Snapshot materialization tables are not protected by forced RLS';
  END IF;
END
$arena_rollback_and_security_assertions$;

ROLLBACK;
