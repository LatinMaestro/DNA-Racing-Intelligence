BEGIN;

SET LOCAL app.owner_id = '60000000-0000-4000-8000-000000000001';

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES ('60000000-0000-4000-8000-000000000001', 'synthetic_lineage_owner');

INSERT INTO dna.import_batch (
  id, owner_id, source_type, source_filename, checksum_sha256,
  detected_encoding, schema_version, status, uploaded_at, import_completed_at,
  source_rows, accepted_rows, rejected_rows, warning_rows
)
VALUES (
  '60000000-0000-4000-8000-000000000010',
  '60000000-0000-4000-8000-000000000001',
  'core_details', 'synthetic-core-details.csv', repeat('6', 64),
  'utf_8', 'core-details/v1', 'accepted',
  '2026-07-23T06:00:00Z', '2026-07-23T06:01:00Z',
  14, 14, 0, 0
);

INSERT INTO dna.core (
  id, owner_id, source_core_id, display_name, core_class,
  element, f_number, sex, source_import_batch_id
)
VALUES
  ('60000000-0000-4000-8000-000000006101', '60000000-0000-4000-8000-000000000001', 'g1', 'Synthetic G1', 'Genesis', 'Metal', 1, 'male', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006102', '60000000-0000-4000-8000-000000000001', 'g2', 'Synthetic G2', 'Genesis', 'Fire', 2, 'female', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006103', '60000000-0000-4000-8000-000000000001', 'g3', 'Synthetic G3', 'Genesis', 'Earth', 3, 'male', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006104', '60000000-0000-4000-8000-000000000001', 'g4', 'Synthetic G4', 'Genesis', 'Water', 4, 'female', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006111', '60000000-0000-4000-8000-000000000001', 'p1', 'Synthetic P1', 'Morphed', 'Fire', 3, 'male', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006112', '60000000-0000-4000-8000-000000000001', 'p2', 'Synthetic P2', 'Morphed', 'Water', 7, 'female', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006121', '60000000-0000-4000-8000-000000000001', 'child', 'Synthetic Child', 'Freak', 'Water', 10, 'male', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006122', '60000000-0000-4000-8000-000000000001', 'full', 'Synthetic Full Sibling', 'Freak', 'Water', 10, 'female', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006123', '60000000-0000-4000-8000-000000000001', 'half', 'Synthetic Half Sibling', 'Freak', 'Earth', 6, 'female', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006131', '60000000-0000-4000-8000-000000000001', 'grandchild', 'Synthetic Grandchild', 'X-Class', 'Water', 14, 'female', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006132', '60000000-0000-4000-8000-000000000001', 'great-grandchild', 'Synthetic Great Grandchild', 'X-Class', 'Water', 17, 'male', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006141', '60000000-0000-4000-8000-000000000001', 'incomplete', 'Synthetic Incomplete', 'Morphed', 'Fire', 3, 'female', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006151', '60000000-0000-4000-8000-000000000001', 'cycle-a', 'Synthetic Cycle A', 'Morphed', 'Fire', 3, 'male', '60000000-0000-4000-8000-000000000010'),
  ('60000000-0000-4000-8000-000000006152', '60000000-0000-4000-8000-000000000001', 'cycle-b', 'Synthetic Cycle B', 'Morphed', 'Earth', 4, 'female', '60000000-0000-4000-8000-000000000010');

INSERT INTO dna.core_parent (
  id, owner_id, child_core_id, parent_core_id,
  parent_role, source_import_batch_id
)
SELECT
  md5(child_id::text || ':' || parent_id::text)::uuid,
  '60000000-0000-4000-8000-000000000001',
  child_id,
  parent_id,
  parent_role,
  '60000000-0000-4000-8000-000000000010'
FROM (VALUES
  ('60000000-0000-4000-8000-000000006111'::uuid, '60000000-0000-4000-8000-000000006101'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006111'::uuid, '60000000-0000-4000-8000-000000006102'::uuid, 'parent_2'),
  ('60000000-0000-4000-8000-000000006112'::uuid, '60000000-0000-4000-8000-000000006103'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006112'::uuid, '60000000-0000-4000-8000-000000006104'::uuid, 'parent_2'),
  ('60000000-0000-4000-8000-000000006121'::uuid, '60000000-0000-4000-8000-000000006111'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006121'::uuid, '60000000-0000-4000-8000-000000006112'::uuid, 'parent_2'),
  ('60000000-0000-4000-8000-000000006122'::uuid, '60000000-0000-4000-8000-000000006111'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006122'::uuid, '60000000-0000-4000-8000-000000006112'::uuid, 'parent_2'),
  ('60000000-0000-4000-8000-000000006123'::uuid, '60000000-0000-4000-8000-000000006111'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006123'::uuid, '60000000-0000-4000-8000-000000006103'::uuid, 'parent_2'),
  ('60000000-0000-4000-8000-000000006131'::uuid, '60000000-0000-4000-8000-000000006121'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006131'::uuid, '60000000-0000-4000-8000-000000006104'::uuid, 'parent_2'),
  ('60000000-0000-4000-8000-000000006132'::uuid, '60000000-0000-4000-8000-000000006131'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006132'::uuid, '60000000-0000-4000-8000-000000006103'::uuid, 'parent_2'),
  ('60000000-0000-4000-8000-000000006141'::uuid, '60000000-0000-4000-8000-000000006101'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006151'::uuid, '60000000-0000-4000-8000-000000006152'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006151'::uuid, '60000000-0000-4000-8000-000000006101'::uuid, 'parent_2'),
  ('60000000-0000-4000-8000-000000006152'::uuid, '60000000-0000-4000-8000-000000006151'::uuid, 'parent_1'),
  ('60000000-0000-4000-8000-000000006152'::uuid, '60000000-0000-4000-8000-000000006102'::uuid, 'parent_2')
) AS edge(child_id, parent_id, parent_role);

SELECT * FROM dna.refresh_core_lineage('2026-07-23T06:02:00Z');

DO $lineage_assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM dna.evaluate_family_pair(
      '60000000-0000-4000-8000-000000006121',
      '60000000-0000-4000-8000-000000006111'
    ) WHERE eligibility_status = 'ineligible' AND relation_code = 'parent'
  ) THEN RAISE EXCEPTION 'Parent restriction was not enforced'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.evaluate_family_pair(
      '60000000-0000-4000-8000-000000006131',
      '60000000-0000-4000-8000-000000006111'
    ) WHERE eligibility_status = 'ineligible' AND relation_code = 'grandparent'
  ) THEN RAISE EXCEPTION 'Grandparent restriction was not enforced'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.evaluate_family_pair(
      '60000000-0000-4000-8000-000000006121',
      '60000000-0000-4000-8000-000000006122'
    ) WHERE eligibility_status = 'ineligible' AND relation_code = 'full_sibling'
  ) THEN RAISE EXCEPTION 'Full-sibling restriction was not enforced'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.evaluate_family_pair(
      '60000000-0000-4000-8000-000000006121',
      '60000000-0000-4000-8000-000000006123'
    ) WHERE eligibility_status = 'eligible' AND relation_code = 'half_sibling_allowed'
  ) THEN RAISE EXCEPTION 'Confirmed half-sibling allowance was widened'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.evaluate_family_pair(
      '60000000-0000-4000-8000-000000006132',
      '60000000-0000-4000-8000-000000006111'
    ) WHERE eligibility_status = 'eligible' AND relation_code = 'distant_descendant_allowed'
  ) THEN RAISE EXCEPTION 'Confirmed distant-descendant allowance was widened'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.evaluate_family_pair(
      '60000000-0000-4000-8000-000000006141',
      '60000000-0000-4000-8000-000000006104'
    ) WHERE eligibility_status = 'review_required' AND relation_code = 'incomplete_lineage'
  ) THEN RAISE EXCEPTION 'Incomplete lineage did not fail closed'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dna.evaluate_family_pair(
      '60000000-0000-4000-8000-000000006151',
      '60000000-0000-4000-8000-000000006103'
    ) WHERE eligibility_status = 'review_required' AND relation_code = 'invalid_lineage'
  ) THEN RAISE EXCEPTION 'Cyclic lineage did not fail closed'; END IF;

  IF EXISTS (
    SELECT 1 FROM dna.core_lineage_reachability
    WHERE descendant_core_id = ancestor_core_id
  ) THEN RAISE EXCEPTION 'Cyclic self-reachability entered the lineage graph'; END IF;
END
$lineage_assertions$;

SELECT * FROM dna.refresh_core_lineage('2026-07-23T06:03:00Z');

DO $replay_and_security_assertions$
BEGIN
  IF (SELECT count(*) FROM dna.core_lineage_validation_issue WHERE issue_code = 'cycle') <> 2
    OR (SELECT count(*) FROM dna.core_lineage_validation_issue WHERE issue_code = 'non_genesis_parent_count') <> 1
  THEN
    RAISE EXCEPTION 'Lineage refresh was not deterministic';
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
      AND proc.proname IN ('refresh_core_lineage', 'evaluate_family_pair')
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Lineage functions are executable by PUBLIC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE
      namespace.nspname = 'dna'
      AND relation.relname IN ('core_lineage_reachability', 'core_lineage_validation_issue')
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Lineage tables are not protected by forced RLS';
  END IF;
END
$replay_and_security_assertions$;

ROLLBACK;
