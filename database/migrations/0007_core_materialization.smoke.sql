BEGIN;

SET LOCAL app.owner_id = '70000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('70000000-0000-4000-8000-000000000001', 'synthetic_core_owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES
  (
    '70000000-0000-4000-8000-000000000101',
    '70000000-0000-4000-8000-000000000001',
    'core_details', 'synthetic-core-details-v1.csv', repeat('1', 64),
    'utf_8', 'core-details/v1', 'validating',
    '2026-07-23T07:00:00Z', 3, 0, 3, 0
  ),
  (
    '70000000-0000-4000-8000-000000000102',
    '70000000-0000-4000-8000-000000000001',
    'core_details', 'synthetic-core-details-invalid.csv', repeat('2', 64),
    'utf_8', 'core-details/v1', 'validating',
    '2026-07-23T07:10:00Z', 1, 0, 1, 0
  ),
  (
    '70000000-0000-4000-8000-000000000103',
    '70000000-0000-4000-8000-000000000001',
    'core_details', 'synthetic-core-details-v2.csv', repeat('3', 64),
    'utf_8', 'core-details/v1', 'validating',
    '2026-07-23T07:20:00Z', 4, 0, 4, 0
  );

INSERT INTO dna.dataset_staged_record (
  owner_id, import_batch_id, source_row_number,
  natural_key, fingerprint_sha256, status
)
VALUES
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000101', 1, 'core|g1', repeat('a', 64), 'ready'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000101', 2, 'core|g2', repeat('b', 64), 'ready'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000101', 3, 'core|child', repeat('c', 64), 'ready'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000102', 1, 'core|invalid', repeat('e', 64), 'ready'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000103', 1, 'core|g1', repeat('a', 64), 'ready'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000103', 2, 'core|g2', repeat('b', 64), 'ready'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000103', 3, 'core|child', repeat('c', 64), 'ready'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000103', 4, 'core|full', repeat('d', 64), 'ready');

INSERT INTO dna.normalized_core_staged_fact (
  owner_id, import_batch_id, source_row_number,
  source_core_id, display_name, core_class, element, f_number, sex,
  color_source_value, father_source_core_id, father_name_source_value,
  mother_source_core_id, mother_name_source_value
)
VALUES
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000101', 1, 'g1', 'Synthetic G1', 'Genesis', 'Metal', 1, 'male', 'silver', NULL, NULL, NULL, NULL),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000101', 2, 'g2', 'Synthetic G2', 'Genesis', 'Fire', 2, 'female', 'red', NULL, NULL, NULL, NULL),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000101', 3, 'child', 'Synthetic Child', 'Morphed', 'Fire', 3, 'male', 'orange', 'g1', 'Synthetic G1', 'g2', 'Synthetic G2'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000102', 1, 'invalid', 'Synthetic Invalid', 'Morphed', 'Fire', 3, 'female', NULL, 'invalid', 'Synthetic Invalid', 'g2', 'Synthetic G2'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000103', 1, 'g1', 'Synthetic G1', 'Genesis', 'Metal', 1, 'male', 'silver', NULL, NULL, NULL, NULL),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000103', 2, 'g2', 'Synthetic G2', 'Genesis', 'Fire', 2, 'female', 'red', NULL, NULL, NULL, NULL),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000103', 3, 'child', 'Synthetic Child', 'Morphed', 'Fire', 3, 'male', 'orange', 'g1', 'Synthetic G1', 'g2', 'Synthetic G2'),
  ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000103', 4, 'full', 'Synthetic Full Sibling', 'Morphed', 'Fire', 3, 'female', 'orange', 'g1', 'Synthetic G1', 'g2', 'Synthetic G2');

SELECT * FROM dna.accept_staged_core_dataset(
  '70000000-0000-4000-8000-000000000101',
  '70000000-0000-4000-8000-000000000201',
  '2026-07-23T07:01:00Z',
  '2026-07-23T07:02:00Z',
  NULL
);

DO $first_version_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.active_core_details) <> 3
    OR (SELECT count(*) FROM dna.core_parent WHERE active_in_core_details) <> 2
    OR (SELECT count(*) FROM dna.core_lineage_validation_issue) <> 0
  THEN
    RAISE EXCEPTION 'First Core Details version did not materialize exactly';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.evaluate_family_pair(
      md5('70000000-0000-4000-8000-000000000001:core:child')::uuid,
      md5('70000000-0000-4000-8000-000000000001:core:g1')::uuid
    )
    WHERE eligibility_status = 'ineligible' AND relation_code = 'parent'
  ) THEN
    RAISE EXCEPTION 'Materialized parent edge did not reach family validation';
  END IF;
END
$first_version_assertions$;

SELECT * FROM dna.accept_staged_core_dataset(
  '70000000-0000-4000-8000-000000000102',
  '70000000-0000-4000-8000-000000000202',
  '2026-07-23T07:11:00Z',
  '2026-07-23T07:12:00Z',
  NULL
);

DO $quarantine_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dna.import_batch
    WHERE
      id = '70000000-0000-4000-8000-000000000102'
      AND status = 'quarantined'
      AND accepted_rows = 0
  ) OR NOT EXISTS (
    SELECT 1
    FROM dna.dataset_staged_record
    WHERE
      import_batch_id = '70000000-0000-4000-8000-000000000102'
      AND status = 'quarantined'
      AND issue_codes @> ARRAY['SELF_PARENT']
  ) THEN
    RAISE EXCEPTION 'Self-parent row was not quarantined';
  END IF;

  IF (SELECT count(*) FROM dna.active_core_details) <> 3
    OR (SELECT count(*) FROM dna.dataset_version WHERE source_type = 'core_details') <> 1
  THEN
    RAISE EXCEPTION 'Quarantined batch changed active Core Details state';
  END IF;
END
$quarantine_assertions$;

SELECT * FROM dna.accept_staged_core_dataset(
  '70000000-0000-4000-8000-000000000103',
  '70000000-0000-4000-8000-000000000203',
  '2026-07-23T07:21:00Z',
  '2026-07-23T07:22:00Z',
  NULL
);

DO $second_version_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.active_core_details) <> 4
    OR (SELECT count(*) FROM dna.core_parent WHERE active_in_core_details) <> 4
    OR (SELECT count(*) FROM dna.core_import_provenance WHERE is_selected_fact) <> 7
    OR (SELECT count(*) FROM dna.core_parent_import_provenance WHERE is_selected_fact) <> 6
  THEN
    RAISE EXCEPTION 'Cumulative Core Details materialization lost provenance';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.evaluate_family_pair(
      md5('70000000-0000-4000-8000-000000000001:core:child')::uuid,
      md5('70000000-0000-4000-8000-000000000001:core:full')::uuid
    )
    WHERE eligibility_status = 'ineligible' AND relation_code = 'full_sibling'
  ) THEN
    RAISE EXCEPTION 'Materialized full siblings were not restricted';
  END IF;
END
$second_version_assertions$;

SELECT * FROM dna.accept_staged_core_dataset(
  '70000000-0000-4000-8000-000000000103',
  '70000000-0000-4000-8000-000000000204',
  '2026-07-23T07:23:00Z',
  '2026-07-23T07:24:00Z',
  NULL
);

DO $replay_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.dataset_version WHERE source_type = 'core_details') <> 2
    OR (SELECT count(*) FROM dna.core) <> 4
    OR (SELECT count(*) FROM dna.core_import_provenance) <> 7
    OR (SELECT count(*) FROM dna.core_parent) <> 4
    OR (SELECT count(*) FROM dna.core_parent_import_provenance) <> 6
  THEN
    RAISE EXCEPTION 'Exact Core Details replay duplicated facts or provenance';
  END IF;
END
$replay_assertions$;

SELECT * FROM dna.rollback_active_dataset(
  'core_details',
  'synthetic rollback to first accepted Core Details version',
  '2026-07-23T07:30:00Z'
);

DO $rollback_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.active_core_details) <> 3
    OR (SELECT count(*) FROM dna.core_parent WHERE active_in_core_details) <> 2
    OR (SELECT count(*) FROM dna.core_parent_import_provenance) <> 6
    OR (SELECT count(*) FROM dna.core_lineage_reachability) <> 2
  THEN
    RAISE EXCEPTION 'Core Details rollback did not restore the prior active graph';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.evaluate_family_pair(
      md5('70000000-0000-4000-8000-000000000001:core:child')::uuid,
      md5('70000000-0000-4000-8000-000000000001:core:full')::uuid
    )
    WHERE
      eligibility_status = 'review_required'
      AND relation_code = 'inactive_core_details'
  ) THEN
    RAISE EXCEPTION 'Rolled-back Core Details remained breeding-eligible';
  END IF;
END
$rollback_assertions$;

DO $security_assertions$
BEGIN
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
        'accept_staged_core_dataset',
        'evaluate_family_pair',
        'evaluate_family_pair_graph',
        'refresh_core_lineage',
        'refresh_core_lineage_unfiltered'
      )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Core materialization functions are executable by PUBLIC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE
      namespace.nspname = 'dna'
      AND relation.relname IN (
        'normalized_core_staged_fact',
        'core_parent_import_provenance'
      )
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Core materialization tables are not protected by forced RLS';
  END IF;
END
$security_assertions$;

ROLLBACK;
