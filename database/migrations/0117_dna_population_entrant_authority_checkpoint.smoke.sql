BEGIN;

DO $contract$
BEGIN
  IF to_regclass('dna.dna_population_entrant_authority_generation') IS NULL
     OR to_regclass('dna.dna_population_entrant_authority_chunk') IS NULL
     OR to_regprocedure(
       'dna.begin_dna_population_entrant_authority_generation(uuid,jsonb,timestamp with time zone)'
     ) IS NULL
     OR to_regprocedure(
       'dna.register_dna_population_entrant_authority_chunk(uuid,text,jsonb,timestamp with time zone)'
     ) IS NULL
     OR to_regprocedure(
       'dna.read_dna_population_entrant_authority_generation(uuid,text)'
     ) IS NULL
     OR to_regprocedure(
       'dna.read_dna_population_entrant_authority_chunk_manifests(uuid,text,integer,integer)'
     ) IS NULL
     OR to_regprocedure(
       'dna.reject_dna_population_entrant_authority_chunk_mutation()'
     ) IS NULL THEN
    RAISE EXCEPTION 'population entrant authority checkpoint schema contract is invalid';
  END IF;

  IF has_table_privilege(
       'dna_app_runtime',
       'dna.dna_population_entrant_authority_generation',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR has_table_privilege(
       'dna_app_runtime',
       'dna.dna_population_entrant_authority_chunk',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.begin_dna_population_entrant_authority_generation(uuid,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.register_dna_population_entrant_authority_chunk(uuid,text,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_population_entrant_authority_generation(uuid,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.read_dna_population_entrant_authority_chunk_manifests(uuid,text,integer,integer)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'dna_app_runtime',
       'dna.reject_dna_population_entrant_authority_chunk_mutation()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'population entrant authority runtime contract is invalid';
  END IF;
END
$contract$;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  (
    '91170000-0000-4000-8000-000000000001',
    'synthetic_population_entrant_checkpoint_owner'
  ),
  (
    '91170000-0000-4000-8000-000000000002',
    'synthetic_population_entrant_checkpoint_other'
  );

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91170000-0000-4000-8000-000000000001';

DO $checkpoint$
DECLARE
  v_owner constant uuid := '91170000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('a', 64);
  v_checkpoint dna.dna_population_entrant_authority_generation%ROWTYPE;
  v_manifest record;
  v_manifest_count integer;
BEGIN
  SELECT * INTO STRICT v_checkpoint
  FROM dna.begin_dna_population_entrant_authority_generation(
    v_owner,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'unresolvedRaceCount', 3,
      'unresolvedRaceSetSha256', v_generation
    ),
    '2026-09-25 06:00:00+00'
  );

  IF v_checkpoint.chunk_count <> 0
     OR v_checkpoint.persisted_race_count <> 0
     OR v_checkpoint.last_source_race_id IS NOT NULL THEN
    RAISE EXCEPTION 'entrant authority checkpoint did not start empty';
  END IF;

  SELECT * INTO STRICT v_checkpoint
  FROM dna.begin_dna_population_entrant_authority_generation(
    v_owner,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'unresolvedRaceCount', 3,
      'unresolvedRaceSetSha256', v_generation
    ),
    '2026-09-25 06:00:30+00'
  );

  IF v_checkpoint.chunk_count <> 0
     OR v_checkpoint.persisted_race_count <> 0 THEN
    RAISE EXCEPTION 'exact generation replay changed checkpoint state';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.begin_dna_population_entrant_authority_generation(
      v_owner,
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'unresolvedRaceCount', 4,
        'unresolvedRaceSetSha256', v_generation
      ),
      '2026-09-25 06:00:40+00'
    );
    RAISE EXCEPTION 'conflicting generation replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%generation replay conflicts%' THEN
      RAISE;
    END IF;
  END;

  SELECT * INTO STRICT v_checkpoint
  FROM dna.register_dna_population_entrant_authority_chunk(
    v_owner,
    v_generation,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'chunkOrdinal', 1,
      'objectKey', 'private/entrant/chunk-1.json',
      'bodySha256', repeat('b', 64),
      'byteLength', 512,
      'rowCount', 2,
      'firstSourceRaceId', 'race-1',
      'lastSourceRaceId', 'race-2',
      'raceSetSha256', repeat('c', 64),
      'recordSetSha256', repeat('d', 64)
    ),
    '2026-09-25 06:01:00+00'
  );

  IF v_checkpoint.chunk_count <> 1
     OR v_checkpoint.persisted_race_count <> 2
     OR v_checkpoint.last_source_race_id <> 'race-2' THEN
    RAISE EXCEPTION 'first entrant authority chunk did not advance checkpoint';
  END IF;

  SELECT * INTO STRICT v_checkpoint
  FROM dna.register_dna_population_entrant_authority_chunk(
    v_owner,
    v_generation,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'chunkOrdinal', 1,
      'objectKey', 'private/entrant/chunk-1.json',
      'bodySha256', repeat('b', 64),
      'byteLength', 512,
      'rowCount', 2,
      'firstSourceRaceId', 'race-1',
      'lastSourceRaceId', 'race-2',
      'raceSetSha256', repeat('c', 64),
      'recordSetSha256', repeat('d', 64)
    ),
    '2026-09-25 06:01:30+00'
  );

  IF v_checkpoint.chunk_count <> 1
     OR v_checkpoint.persisted_race_count <> 2 THEN
    RAISE EXCEPTION 'exact chunk replay changed checkpoint state';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.register_dna_population_entrant_authority_chunk(
      v_owner,
      v_generation,
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'chunkOrdinal', 1,
        'objectKey', 'private/entrant/chunk-1-conflict.json',
        'bodySha256', repeat('e', 64),
        'byteLength', 512,
        'rowCount', 2,
        'firstSourceRaceId', 'race-1',
        'lastSourceRaceId', 'race-2',
        'raceSetSha256', repeat('c', 64),
        'recordSetSha256', repeat('d', 64)
      ),
      '2026-09-25 06:01:40+00'
    );
    RAISE EXCEPTION 'conflicting chunk replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%chunk replay conflicts%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM *
    FROM dna.register_dna_population_entrant_authority_chunk(
      v_owner,
      v_generation,
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'chunkOrdinal', 3,
        'objectKey', 'private/entrant/chunk-3.json',
        'bodySha256', repeat('f', 64),
        'byteLength', 256,
        'rowCount', 1,
        'firstSourceRaceId', 'race-3',
        'lastSourceRaceId', 'race-3',
        'raceSetSha256', repeat('1', 64),
        'recordSetSha256', repeat('2', 64)
      ),
      '2026-09-25 06:01:50+00'
    );
    RAISE EXCEPTION 'non-contiguous entrant authority chunk was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%chunk ordinal is not contiguous%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM *
    FROM dna.register_dna_population_entrant_authority_chunk(
      v_owner,
      v_generation,
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'chunkOrdinal', 2,
        'objectKey', 'private/entrant/chunk-2-overlap.json',
        'bodySha256', repeat('3', 64),
        'byteLength', 256,
        'rowCount', 1,
        'firstSourceRaceId', 'race-2',
        'lastSourceRaceId', 'race-2',
        'raceSetSha256', repeat('4', 64),
        'recordSetSha256', repeat('5', 64)
      ),
      '2026-09-25 06:02:00+00'
    );
    RAISE EXCEPTION 'overlapping entrant authority chunk was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%chunk ranges overlap%' THEN
      RAISE;
    END IF;
  END;

  SELECT * INTO STRICT v_checkpoint
  FROM dna.register_dna_population_entrant_authority_chunk(
    v_owner,
    v_generation,
    jsonb_build_object(
      'version', 1,
      'generationId', v_generation,
      'chunkOrdinal', 2,
      'objectKey', 'private/entrant/chunk-2.json',
      'bodySha256', repeat('6', 64),
      'byteLength', 256,
      'rowCount', 1,
      'firstSourceRaceId', 'race-3',
      'lastSourceRaceId', 'race-3',
      'raceSetSha256', repeat('7', 64),
      'recordSetSha256', repeat('8', 64)
    ),
    '2026-09-25 06:02:10+00'
  );

  IF v_checkpoint.chunk_count <> 2
     OR v_checkpoint.persisted_race_count <> 3
     OR v_checkpoint.last_source_race_id <> 'race-3' THEN
    RAISE EXCEPTION 'second entrant authority chunk did not advance checkpoint';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.register_dna_population_entrant_authority_chunk(
      v_owner,
      v_generation,
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'chunkOrdinal', 3,
        'objectKey', 'private/entrant/chunk-3-overrun.json',
        'bodySha256', repeat('9', 64),
        'byteLength', 256,
        'rowCount', 1,
        'firstSourceRaceId', 'race-4',
        'lastSourceRaceId', 'race-4',
        'raceSetSha256', repeat('0', 64),
        'recordSetSha256', repeat('1', 64)
      ),
      '2026-09-25 06:02:20+00'
    );
    RAISE EXCEPTION 'entrant authority exceeded audited unresolved count';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%exceeds audited unresolved count%' THEN
      RAISE;
    END IF;
  END;

  SELECT * INTO STRICT v_checkpoint
  FROM dna.read_dna_population_entrant_authority_generation(
    v_owner,
    v_generation
  );

  IF v_checkpoint.chunk_count <> 2
     OR v_checkpoint.persisted_race_count <> 3
     OR v_checkpoint.unresolved_race_count <> 3
     OR v_checkpoint.unresolved_race_set_sha256::text <> v_generation THEN
    RAISE EXCEPTION 'entrant authority checkpoint read lost exact authority';
  END IF;

  SELECT count(*) INTO v_manifest_count
  FROM dna.read_dna_population_entrant_authority_chunk_manifests(
    v_owner,
    v_generation,
    0,
    100
  );
  IF v_manifest_count <> 2 THEN
    RAISE EXCEPTION 'entrant authority manifest read did not return all chunks';
  END IF;

  SELECT * INTO STRICT v_manifest
  FROM dna.read_dna_population_entrant_authority_chunk_manifests(
    v_owner,
    v_generation,
    1,
    1
  );
  IF v_manifest.chunk_ordinal <> 2
     OR v_manifest.row_count <> 1
     OR v_manifest.last_source_race_id <> 'race-3' THEN
    RAISE EXCEPTION 'entrant authority manifest pagination returned wrong chunk';
  END IF;

  SELECT count(*) INTO v_manifest_count
  FROM dna.read_dna_population_entrant_authority_chunk_manifests(
    v_owner,
    v_generation,
    2,
    100
  );
  IF v_manifest_count <> 0 THEN
    RAISE EXCEPTION 'entrant authority manifest pagination did not terminate';
  END IF;

  BEGIN
    PERFORM *
    FROM dna.read_dna_population_entrant_authority_chunk_manifests(
      v_owner,
      v_generation,
      3,
      100
    );
    RAISE EXCEPTION 'entrant authority manifest accepted an invalid cursor';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%manifest cursor is invalid%' THEN
      RAISE;
    END IF;
  END;
END
$checkpoint$;

SET LOCAL app.owner_id = '91170000-0000-4000-8000-000000000002';

DO $isolation$
DECLARE
  v_owner constant uuid := '91170000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('a', 64);
BEGIN
  BEGIN
    PERFORM *
    FROM dna.read_dna_population_entrant_authority_generation(
      v_owner,
      v_generation
    );
    RAISE EXCEPTION 'cross-owner entrant authority read was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%owner-scoped population entrant authority read denied%' THEN
      RAISE;
    END IF;
  END;
END
$isolation$;

RESET ROLE;

DO $immutability$
BEGIN
  BEGIN
    UPDATE dna.dna_population_entrant_authority_chunk
    SET body_sha256 = repeat('e', 64)::character(64)
    WHERE owner_id = '91170000-0000-4000-8000-000000000001'
      AND generation_id = repeat('a', 64)::character(64)
      AND chunk_ordinal = 2;
    RAISE EXCEPTION 'privileged entrant authority manifest update was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%chunk manifests are immutable%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM dna.dna_population_entrant_authority_chunk
    WHERE owner_id = '91170000-0000-4000-8000-000000000001'
      AND generation_id = repeat('a', 64)::character(64)
      AND chunk_ordinal = 2;
    RAISE EXCEPTION 'privileged entrant authority manifest deletion was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%chunk manifests are immutable%' THEN
      RAISE;
    END IF;
  END;
END
$immutability$;

INSERT INTO dna.dna_population_entrant_authority_chunk (
  owner_id,
  generation_id,
  chunk_ordinal,
  object_key,
  body_sha256,
  byte_length,
  row_count,
  first_source_race_id,
  last_source_race_id,
  race_set_sha256,
  record_set_sha256,
  registered_at
) VALUES (
  '91170000-0000-4000-8000-000000000001',
  repeat('a', 64)::character(64),
  3,
  'private/entrant/rogue-chunk-3.json',
  repeat('e', 64)::character(64),
  128,
  1,
  'race-4',
  'race-4',
  repeat('f', 64)::character(64),
  repeat('0', 64)::character(64),
  '2026-09-25 06:02:30+00'
);

SET LOCAL ROLE dna_app_runtime;
SET LOCAL app.owner_id = '91170000-0000-4000-8000-000000000001';

DO $tamper$
DECLARE
  v_owner constant uuid := '91170000-0000-4000-8000-000000000001';
  v_generation constant text := repeat('a', 64);
BEGIN
  BEGIN
    PERFORM *
    FROM dna.read_dna_population_entrant_authority_generation(
      v_owner,
      v_generation
    );
    RAISE EXCEPTION 'tampered entrant authority checkpoint remained readable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%checkpoint is inconsistent%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM *
    FROM dna.register_dna_population_entrant_authority_chunk(
      v_owner,
      v_generation,
      jsonb_build_object(
        'version', 1,
        'generationId', v_generation,
        'chunkOrdinal', 3,
        'objectKey', 'private/entrant/chunk-after-tamper.json',
        'bodySha256', repeat('2', 64),
        'byteLength', 256,
        'rowCount', 1,
        'firstSourceRaceId', 'race-4',
        'lastSourceRaceId', 'race-4',
        'raceSetSha256', repeat('3', 64),
        'recordSetSha256', repeat('4', 64)
      ),
      '2026-09-25 06:03:00+00'
    );
    RAISE EXCEPTION 'tampered entrant authority checkpoint accepted an append';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%checkpoint is inconsistent%' THEN
      RAISE;
    END IF;
  END;
END
$tamper$;

RESET ROLE;

ROLLBACK;
