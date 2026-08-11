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

INSERT INTO dna.core (
  id,
  owner_id,
  source_core_id,
  display_name
)
VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'synthetic-core-1',
  'Synthetic Core One'
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

INSERT INTO dna.core (
  id,
  owner_id,
  source_core_id,
  display_name
)
VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '22222222-2222-4222-8222-222222222222',
  'synthetic-core-2',
  'Synthetic Core Two'
);

SELECT set_config(
  'app.owner_id',
  '11111111-1111-4111-8111-111111111111',
  true
);

DO $mutation_assertions$
DECLARE
  v_applied record;
  v_replayed record;
  v_updated record;
  v_removed record;
BEGIN
  SELECT *
  INTO v_applied
  FROM dna.set_owner_vault_core(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    true,
    true,
    0,
    'vault-create-1',
    repeat('a', 64)::character(64),
    '2026-08-11T00:00:00.000Z'
  );

  IF
    v_applied.disposition <> 'applied'
    OR NOT v_applied.in_my_vault
    OR NOT v_applied.me_eligible
    OR v_applied.version <> 1
  THEN
    RAISE EXCEPTION 'initial Vault state was not applied';
  END IF;

  SELECT *
  INTO v_replayed
  FROM dna.set_owner_vault_core(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    true,
    true,
    0,
    'vault-create-1',
    repeat('a', 64)::character(64),
    '2026-08-11T00:00:01.000Z'
  );

  IF
    v_replayed.disposition <> 'replayed'
    OR v_replayed.version <> 1
  THEN
    RAISE EXCEPTION 'exact Vault replay was not idempotent';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.set_owner_vault_core(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      true,
      true,
      1,
      'vault-create-1',
      repeat('b', 64)::character(64),
      '2026-08-11T00:00:02.000Z'
    );
    RAISE EXCEPTION 'conflicting Vault replay was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'conflicting Vault replay was accepted' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM *
    FROM dna.set_owner_vault_core(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      true,
      false,
      0,
      'vault-stale-1',
      repeat('c', 64)::character(64),
      '2026-08-11T00:00:03.000Z'
    );
    RAISE EXCEPTION 'stale Vault version was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'stale Vault version was accepted' THEN
        RAISE;
      END IF;
  END;

  SELECT *
  INTO v_updated
  FROM dna.set_owner_vault_core(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    true,
    false,
    1,
    'vault-update-1',
    repeat('d', 64)::character(64),
    '2026-08-11T00:00:04.000Z'
  );

  IF
    v_updated.version <> 2
    OR NOT v_updated.in_my_vault
    OR v_updated.me_eligible
  THEN
    RAISE EXCEPTION 'ME state update was not applied';
  END IF;

  SELECT *
  INTO v_removed
  FROM dna.set_owner_vault_core(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    false,
    false,
    2,
    'vault-remove-1',
    repeat('e', 64)::character(64),
    '2026-08-11T00:00:05.000Z'
  );

  IF
    v_removed.version <> 3
    OR v_removed.in_my_vault
    OR v_removed.me_eligible
    OR NOT EXISTS (
      SELECT 1
      FROM dna.owner_vault_core
      WHERE core_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )
  THEN
    RAISE EXCEPTION 'Vault removal did not retain inactive state';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.set_owner_vault_core(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      false,
      true,
      3,
      'vault-invalid-me-1',
      repeat('f', 64)::character(64),
      '2026-08-11T00:00:06.000Z'
    );
    RAISE EXCEPTION 'inactive ME-eligible Vault state was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'inactive ME-eligible Vault state was accepted' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM *
    FROM dna.set_owner_vault_core(
      '22222222-2222-4222-8222-222222222222',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      true,
      false,
      0,
      'vault-cross-owner-1',
      repeat('1', 64)::character(64),
      '2026-08-11T00:00:07.000Z'
    );
    RAISE EXCEPTION 'cross-owner Vault mutation was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'cross-owner Vault mutation was accepted' THEN
        RAISE;
      END IF;
  END;
END
$mutation_assertions$;

DO $security_assertions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE
      namespace.nspname = 'dna'
      AND relation.relname IN (
        'owner_vault_core',
        'owner_vault_mutation_receipt'
      )
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'owner Vault tables are not protected by forced RLS';
  END IF;

  IF has_function_privilege(
    'public',
    'dna.set_owner_vault_core(uuid,uuid,boolean,boolean,bigint,text,character,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Vault mutation function is executable by PUBLIC';
  END IF;

  IF
    NOT has_table_privilege(
      'dna_app_runtime',
      'dna.owner_vault_core',
      'SELECT'
    )
    OR has_table_privilege(
      'dna_app_runtime',
      'dna.owner_vault_core',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR has_table_privilege(
      'dna_app_runtime',
      'dna.owner_vault_mutation_receipt',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
    OR NOT has_function_privilege(
      'dna_app_runtime',
      'dna.set_owner_vault_core(uuid,uuid,boolean,boolean,bigint,text,character,timestamptz)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'runtime Vault grants are not minimal';
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
DECLARE
  v_restored record;
BEGIN
  IF (
    SELECT count(*)
    FROM dna.owner_vault_core
  ) <> 1 THEN
    RAISE EXCEPTION 'runtime Vault SELECT crossed the owner boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.core
    WHERE owner_id = '22222222-2222-4222-8222-222222222222'
  ) THEN
    RAISE EXCEPTION 'runtime Core Details SELECT crossed the owner boundary';
  END IF;

  BEGIN
    UPDATE dna.owner_vault_core
    SET in_my_vault = true
    WHERE core_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    RAISE EXCEPTION 'runtime direct Vault update was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  SELECT *
  INTO v_restored
  FROM dna.set_owner_vault_core(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    true,
    false,
    3,
    'vault-runtime-restore-1',
    repeat('2', 64)::character(64),
    '2026-08-11T00:00:08.000Z'
  );

  IF
    v_restored.version <> 4
    OR NOT v_restored.in_my_vault
    OR v_restored.me_eligible
  THEN
    RAISE EXCEPTION 'runtime Vault mutation function did not apply safely';
  END IF;
END
$runtime_assertions$;

RESET SESSION AUTHORIZATION;

ROLLBACK;
