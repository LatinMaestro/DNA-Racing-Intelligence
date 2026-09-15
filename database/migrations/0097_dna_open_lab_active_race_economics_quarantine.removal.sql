BEGIN;

DO $removal$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure(
       'dna.validate_dna_open_lab_active_race_canonical(text,jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'active-race quarantine validator remains installed';
  END IF;
  IF to_regprocedure(
       'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)'
     ) IS NOT NULL THEN
    SELECT pg_get_functiondef(
      'dna.stage_dna_open_lab_current_race_candidate(uuid,uuid,timestamp with time zone,timestamp with time zone,jsonb,jsonb,jsonb,jsonb)'::regprocedure
    ) INTO v_definition;
    IF position('IF v_key_count <> 12 OR NOT (' IN v_definition) = 0
       OR position('PERFORM dna.validate_dna_open_lab_active_race_canonical(' IN v_definition) > 0 THEN
      RAISE EXCEPTION 'strict active-race validator was not restored';
    END IF;
  END IF;
END
$removal$;

ROLLBACK;
