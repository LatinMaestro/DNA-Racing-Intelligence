BEGIN;

DO $contract$
BEGIN
  IF to_regprocedure(
       'dna.begin_race_merge_outcome_object(uuid,text,text,text,bigint,text)'
     ) IS NULL
     OR to_regprocedure(
       'dna.read_race_merge_core_outcomes(uuid,text,bigint)'
     ) IS NULL
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.append_race_merge_outcomes(uuid,text,text,jsonb)', 'EXECUTE'
     )
     OR has_table_privilege(
       'dna_app_runtime', 'dna.race_merge_outcome',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'Race Merge outcome runtime contract is invalid';
  END IF;
END
$contract$;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES (
  'a1220000-0000-4000-8000-000000000001',
  'synthetic_race_merge_outcome_owner'
);

\if :{?skip_runtime_role}
\else
SET LOCAL ROLE dna_app_runtime;
\endif
SET LOCAL app.owner_id = 'a1220000-0000-4000-8000-000000000001';

DO $ingest$
DECLARE
  v_state text;
  v_batch record;
  v_receipt record;
  v_generation record;
  v_rows jsonb := jsonb_build_array(
    jsonb_build_object(
      'sourceCoreId', 101, 'sourceRaceId', 'race-1',
      'finishPosition', 2, 'elapsedMilliseconds', 12345,
      'source', 'race_merge', 'sourceObjectSha256', repeat('a', 64),
      'sourceRowNumber', 1
    ),
    jsonb_build_object(
      'sourceCoreId', 101, 'sourceRaceId', 'race-1',
      'finishPosition', 2, 'elapsedMilliseconds', 12345,
      'source', 'race_merge', 'sourceObjectSha256', repeat('a', 64),
      'sourceRowNumber', 2
    ),
    jsonb_build_object(
      'sourceCoreId', 202, 'sourceRaceId', 'race-2',
      'finishPosition', 1, 'elapsedMilliseconds', 9500,
      'source', 'race_merge', 'sourceObjectSha256', repeat('a', 64),
      'sourceRowNumber', 3
    )
  );
BEGIN
  SELECT dna.begin_race_merge_outcome_object(
    'a1220000-0000-4000-8000-000000000001', 'generation-1',
    repeat('b', 64), 'object-1', 1000, repeat('a', 64)
  ) INTO v_state;
  IF v_state <> 'staging' THEN RAISE EXCEPTION 'object did not stage'; END IF;

  SELECT * INTO STRICT v_batch FROM dna.append_race_merge_outcomes(
    'a1220000-0000-4000-8000-000000000001', 'generation-1',
    'object-1', v_rows
  );
  IF v_batch.accepted_count <> 2 OR v_batch.exact_replay_count <> 1 THEN
    RAISE EXCEPTION 'outcome replay accounting disagrees';
  END IF;

  BEGIN
    PERFORM * FROM dna.append_race_merge_outcomes(
      'a1220000-0000-4000-8000-000000000001', 'generation-1',
      'object-1', jsonb_build_array(jsonb_build_object(
        'sourceCoreId', 101, 'sourceRaceId', 'race-1',
        'finishPosition', 3, 'elapsedMilliseconds', 12345,
        'source', 'race_merge', 'sourceObjectSha256', repeat('a', 64),
        'sourceRowNumber', 4
      ))
    );
    RAISE EXCEPTION 'conflicting outcome was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'conflicting outcome was accepted' THEN RAISE; END IF;
  END;

  SELECT * INTO STRICT v_receipt
  FROM dna.commit_race_merge_outcome_object(
    'a1220000-0000-4000-8000-000000000001', 'generation-1',
    'object-1', jsonb_build_object(
      'byteLength', 1000, 'sha256', repeat('a', 64), 'chunkCount', 1,
      'rowCount', 3, 'orderedOutcomeDigestSha256', repeat('c', 64)
    )
  );
  IF v_receipt.row_count <> 3 THEN RAISE EXCEPTION 'receipt is invalid'; END IF;

  SELECT * INTO STRICT v_generation
  FROM dna.complete_race_merge_outcome_generation(
    'a1220000-0000-4000-8000-000000000001', 'generation-1',
    repeat('b', 64), 1, 2, repeat('d', 64)
  );
  IF v_generation.state <> 'complete'
     OR v_generation.source_row_count <> 3
     OR v_generation.unique_outcome_count <> 2
     OR v_generation.exact_replay_count <> 1 THEN
    RAISE EXCEPTION 'completed generation is invalid';
  END IF;
  IF (SELECT count(*) FROM dna.read_race_merge_core_outcomes(
        'a1220000-0000-4000-8000-000000000001', 'generation-1', 101
      )) <> 1 THEN
    RAISE EXCEPTION 'completed Core outcomes are unavailable';
  END IF;
END
$ingest$;

\if :{?skip_runtime_role}
\else
RESET ROLE;
\endif

ROLLBACK;
