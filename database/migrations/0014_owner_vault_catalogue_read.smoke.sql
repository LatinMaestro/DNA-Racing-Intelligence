BEGIN;

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'synthetic-owner-1'
);

INSERT INTO dna.import_batch (
  id,
  owner_id,
  source_type,
  source_filename,
  checksum_sha256,
  schema_version,
  status,
  uploaded_at,
  import_completed_at,
  source_rows,
  accepted_rows,
  rejected_rows,
  warning_rows
)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'core_details',
  'synthetic-core-details.csv',
  repeat('1', 64),
  'synthetic-v1',
  'accepted',
  '2026-08-11T00:00:00.000Z',
  '2026-08-11T00:01:00.000Z',
  2,
  2,
  0,
  0
);

INSERT INTO dna.core (
  id,
  owner_id,
  source_core_id,
  display_name,
  core_class,
  element,
  f_number,
  sex,
  source_import_batch_id
)
VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '11111111-1111-4111-8111-111111111111',
    'core-101',
    'Fire Runner',
    'Genesis',
    'Fire',
    1,
    'female',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '11111111-1111-4111-8111-111111111111',
    'core-102',
    'Metal Runner',
    'Morphed',
    'Metal',
    2,
    'male',
    '10000000-0000-4000-8000-000000000001'
  );

INSERT INTO dna.core_import_provenance (
  id,
  owner_id,
  core_id,
  import_batch_id,
  source_row_number,
  raw_source_core_id,
  raw_source_name,
  is_selected_fact
)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '10000000-0000-4000-8000-000000000001',
    1,
    'core-101',
    'Fire Runner',
    true
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '10000000-0000-4000-8000-000000000001',
    2,
    'core-102',
    'Metal Runner',
    true
  );

INSERT INTO dna.owner_vault_core (
  id,
  owner_id,
  core_id,
  in_my_vault,
  me_eligible,
  version,
  updated_at
)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  true,
  true,
  2,
  '2026-08-11T00:02:00.000Z'
);

SELECT set_config(
  'app.owner_id',
  '22222222-2222-4222-8222-222222222222',
  true
);

INSERT INTO dna.app_owner (id, clerk_user_id)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'synthetic-owner-2'
);

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

DO $catalogue_assertions$
DECLARE
  v_row record;
BEGIN
  SELECT *
  INTO STRICT v_row
  FROM dna.search_owner_vault_catalogue(
    '11111111-1111-4111-8111-111111111111',
    'fire',
    'Fire',
    'Genesis',
    'female',
    1,
    'catalogue',
    50
  );

  IF
    v_row.source_core_id <> 'core-101'
    OR NOT v_row.in_my_vault
    OR NOT v_row.me_eligible
    OR v_row.version <> 2
  THEN
    RAISE EXCEPTION 'filtered Vault catalogue search returned incorrect state';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.search_owner_vault_catalogue(
      '11111111-1111-4111-8111-111111111111',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'vault',
      500
    )
  ) <> 1 THEN
    RAISE EXCEPTION 'active My Vault search did not exclude unowned cores';
  END IF;

  IF (
    SELECT count(*)
    FROM dna.search_owner_vault_catalogue(
      '11111111-1111-4111-8111-111111111111',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'catalogue',
      50
    )
  ) <> 2 THEN
    RAISE EXCEPTION 'game-wide owner catalogue search is incomplete';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.search_owner_vault_catalogue(
      '22222222-2222-4222-8222-222222222222',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      'catalogue',
      50
    );
    RAISE EXCEPTION 'cross-owner Vault catalogue search was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'cross-owner Vault catalogue search was accepted' THEN
        RAISE;
      END IF;
  END;
END
$catalogue_assertions$;

DO $security_assertions$
BEGIN
  IF has_function_privilege(
    'public',
    'dna.search_owner_vault_catalogue(uuid,text,text,text,text,integer,text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Vault catalogue search is executable by PUBLIC';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.search_owner_vault_catalogue(uuid,text,text,text,text,integer,text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot execute Vault catalogue search';
  END IF;
END
$security_assertions$;

SET LOCAL SESSION AUTHORIZATION dna_app_runtime;

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

DO $runtime_assertions$
BEGIN
  IF (
    SELECT count(*)
    FROM dna.search_owner_vault_catalogue(
      '11111111-1111-4111-8111-111111111111',
      'runner',
      NULL,
      NULL,
      NULL,
      NULL,
      'catalogue',
      50
    )
  ) <> 2 THEN
    RAISE EXCEPTION 'runtime Vault catalogue search failed';
  END IF;

  BEGIN
    PERFORM * FROM dna.active_core_details;
    RAISE EXCEPTION 'runtime gained direct Core Details view access';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$runtime_assertions$;

RESET SESSION AUTHORIZATION;

ROLLBACK;
