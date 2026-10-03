BEGIN;

DO $contract$
BEGIN
  IF to_regprocedure(
       'dna.begin_dna_population_core_history_acquisition_attempt(uuid,jsonb,jsonb)'
     ) IS NULL
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.begin_dna_population_core_history_acquisition_attempt(uuid,jsonb,jsonb)',
       'EXECUTE'
     )
     OR has_table_privilege(
       'dna_app_runtime',
       'dna.dna_population_core_history_authority',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'population Core history authority runtime contract is invalid';
  END IF;
END
$contract$;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES (
  'a1210000-0000-4000-8000-000000000001',
  'synthetic_population_core_history_authority_owner'
);

\if :{?skip_runtime_role}
\else
SET LOCAL ROLE dna_app_runtime;
\endif
SET LOCAL app.owner_id = 'a1210000-0000-4000-8000-000000000001';

DO $begin_population_history$
DECLARE
  v_authority jsonb := jsonb_build_object(
    'version', 1,
    'generationId', 'a1210000-0000-4000-8000-000000000011',
    'coreSetSha256', 'f164b4f7e84942314fc13ae0087c05d7fde41989b4f57d602fbd0e98f2077ce7',
    'coreIds', jsonb_build_array(9001)
  );
  v_cycle jsonb := jsonb_build_object(
    'version', 1,
    'cycleId', 'e6fc1e036760ed26e420dec7809dcd34af28f9f1e3cb032b506ae8ff90ebdab6',
    'attemptId', '38873d7252962aea2651a0709737cb1ea254f8fa9b6182114e59872b6e62750c',
    'previousCompletedCycleId', null,
    'sourceFamily', 'core_race_history',
    'currentStateGenerationId', 'a1210000-0000-4000-8000-000000000011',
    'evaluatedAt', '2026-10-03T04:45:00.000Z',
    'coreSetSha256', 'f164b4f7e84942314fc13ae0087c05d7fde41989b4f57d602fbd0e98f2077ce7',
    'coreIds', jsonb_build_array(9001),
    'attemptNumber', 1,
    'status', 'running',
    'pause', null,
    'completion', null,
    'supersededByAttemptNumber', null
  );
  v_receipt record;
BEGIN
  SELECT * INTO STRICT v_receipt
  FROM dna.begin_dna_population_core_history_acquisition_attempt(
    'a1210000-0000-4000-8000-000000000001',
    v_authority,
    v_cycle
  );
  IF v_receipt.revision <> 1 OR v_receipt.cycle <> v_cycle THEN
    RAISE EXCEPTION 'population Core history begin receipt is invalid';
  END IF;
  SELECT * INTO STRICT v_receipt
  FROM dna.begin_dna_population_core_history_acquisition_attempt(
    'a1210000-0000-4000-8000-000000000001',
    v_authority,
    v_cycle
  );
  IF v_receipt.revision <> 1 OR v_receipt.cycle <> v_cycle THEN
    RAISE EXCEPTION 'population Core history begin replay is invalid';
  END IF;
END
$begin_population_history$;

\if :{?skip_runtime_role}
\else
RESET ROLE;
\endif

DO $verify$
BEGIN
  IF (SELECT count(*) FROM dna.dna_population_core_history_authority
      WHERE owner_id = 'a1210000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(*) FROM dna.dna_core_race_history_acquisition_cycle
      WHERE owner_id = 'a1210000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(*) FROM dna.dna_core_race_history_acquisition_attempt
      WHERE owner_id = 'a1210000-0000-4000-8000-000000000001') <> 1
     OR (SELECT count(*) FROM dna.dna_core_race_history_core_checkpoint
      WHERE owner_id = 'a1210000-0000-4000-8000-000000000001'
        AND core_id = 9001) <> 1 THEN
    RAISE EXCEPTION 'population Core history durable bootstrap is incomplete';
  END IF;
END
$verify$;

ROLLBACK;
