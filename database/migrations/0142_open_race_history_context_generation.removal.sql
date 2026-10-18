DO $removal$
BEGIN
  IF to_regclass('dna.open_race_history_context_generation') IS NOT NULL
    OR to_regclass('dna.open_race_history_context_generation_row') IS NOT NULL
    OR to_regclass('dna.open_race_history_context_generation_active') IS NOT NULL
    OR to_regprocedure('dna.begin_open_race_history_context_generation(uuid,text,text,text)') IS NOT NULL
    OR to_regprocedure('dna.stage_open_race_history_context_rows(uuid,text,text,integer,jsonb)') IS NOT NULL
    OR to_regprocedure('dna.publish_open_race_history_context_generation(uuid,text,text,timestamptz)') IS NOT NULL
    OR to_regprocedure('dna.read_active_open_race_history_context_pointer(uuid)') IS NOT NULL
    OR to_regprocedure('dna.read_open_race_history_contexts(uuid,text,text[],integer)') IS NOT NULL
  THEN RAISE EXCEPTION 'Open Race history context generation removal failed'; END IF;
END
$removal$;
