DO $removal$
BEGIN
  IF to_regclass('dna.dna_population_race_index_race_mode_idx') IS NULL THEN
    RAISE EXCEPTION 'population race mode index was not restored by reversal';
  END IF;
END
$removal$;
