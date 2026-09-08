DO $removal$
BEGIN
  IF to_regprocedure('dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint)') IS NOT NULL
     OR to_regprocedure('dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint)') IS NOT NULL
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'dna_app_runtime',
       'dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamp with time zone)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'DNA Open Lab R2 budget operator API removal is incomplete';
  END IF;
END
$removal$;
