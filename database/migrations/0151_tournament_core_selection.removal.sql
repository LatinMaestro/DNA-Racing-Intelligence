DO $removal$
BEGIN
  IF to_regclass('dna.tournament_core_selection') IS NOT NULL
    OR to_regprocedure(
      'dna.replace_tournament_core_selection(uuid,text,text,text,text,text[],timestamptz)'
    ) IS NOT NULL
    OR to_regprocedure(
      'dna.read_tournament_core_selection(uuid,text,text)'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Tournament Core selection removal failed';
  END IF;
END
$removal$;
