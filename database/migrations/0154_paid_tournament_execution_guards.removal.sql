DO $removal$
BEGIN
  IF to_regclass('dna.race_entry_owner_control') IS NOT NULL
    OR to_regclass('dna.race_entry_owner_control_event') IS NOT NULL
    OR to_regclass('dna.paid_tournament_segment_guard') IS NOT NULL
    OR to_regclass('dna.paid_tournament_segment_guard_event') IS NOT NULL
    OR to_regprocedure(
      'dna.configure_race_entry_owner_control(uuid,uuid,text,text,boolean,boolean,timestamptz,timestamptz)'
    ) IS NOT NULL
    OR to_regprocedure(
      'dna.configure_paid_tournament_segment_guard(uuid,uuid,text,text,text,text,text,text,text,integer,numeric,numeric,numeric,numeric,numeric,timestamptz,timestamptz)'
    ) IS NOT NULL
    OR to_regprocedure('dna.read_race_entry_owner_control(uuid)') IS NOT NULL
    OR to_regprocedure(
      'dna.read_paid_tournament_segment_guards(uuid,integer)'
    ) IS NOT NULL
  THEN RAISE EXCEPTION 'paid Tournament execution guard removal failed'; END IF;
END
$removal$;
