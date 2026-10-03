DO $r2_expired_budget_recovery_removal$
BEGIN
  IF to_regprocedure(
       'dna.reconcile_expired_dna_open_lab_r2_budget_window(uuid)'
     ) IS NOT NULL
     OR to_regclass('dna.dna_open_lab_r2_budget_window') IS NULL
     OR to_regclass('dna.dna_open_lab_r2_budget_reservation') IS NULL
     OR to_regprocedure(
       'dna.open_dna_open_lab_r2_budget_window(uuid,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,bigint,bigint,bigint)'
     ) IS NULL
     OR to_regprocedure(
       'dna.read_dna_open_lab_r2_budget_window(uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'expired R2 budget recovery reversal contract is invalid';
  END IF;
END
$r2_expired_budget_recovery_removal$;
