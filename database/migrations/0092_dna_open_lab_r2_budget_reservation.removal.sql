DO $removal$
BEGIN
  IF to_regclass('dna.dna_open_lab_r2_budget_window') IS NOT NULL
     OR to_regclass('dna.dna_open_lab_r2_budget_reservation') IS NOT NULL
     OR to_regprocedure('dna.open_dna_open_lab_r2_budget_window(uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,bigint,bigint,bigint)') IS NOT NULL
     OR to_regprocedure('dna.reserve_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.account_dna_open_lab_r2_budget(uuid,text,text,text,bigint,bigint,bigint,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('dna.read_dna_open_lab_r2_budget_window(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'DNA Open Lab R2 budget reservation removal is incomplete';
  END IF;
END
$removal$;
