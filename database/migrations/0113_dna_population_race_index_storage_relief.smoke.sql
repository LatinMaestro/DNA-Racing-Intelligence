DO $smoke$
BEGIN
  IF to_regclass('dna.dna_population_race_index_generation') IS NULL
     OR to_regclass('dna.dna_population_race_index_race') IS NULL THEN
    RAISE EXCEPTION 'population race index authority is unavailable';
  END IF;

  IF to_regclass('dna.dna_population_race_index_race_mode_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'unused population race mode index still consumes storage';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_definition
    JOIN pg_class relation ON relation.oid = index_definition.indrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'dna'
      AND relation.relname = 'dna_population_race_index_race'
      AND index_definition.indisprimary
      AND index_definition.indisvalid
  ) THEN
    RAISE EXCEPTION 'population race identity primary key is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'dna'
      AND table_name = 'dna_population_race_index_race'
      AND column_name = 'mode'
  ) THEN
    RAISE EXCEPTION 'population race mode authority was removed';
  END IF;
END
$smoke$;
