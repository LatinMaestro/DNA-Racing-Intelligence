BEGIN;

DO $assert_restored$
BEGIN
  IF to_regprocedure(
    'dna.list_tournament_configurations(uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'legacy Tournament read API was not restored';
  END IF;

  IF to_regprocedure(
    'dna.upsert_tournament_configuration(uuid,text,text,text,text,text,integer[],text,text,text,text,timestamptz)'
  ) IS NULL THEN
    RAISE EXCEPTION 'legacy Tournament write API was not restored';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.list_tournament_configurations(uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'dna_app_runtime',
    'dna.upsert_tournament_configuration(uuid,text,text,text,text,text,integer[],text,text,text,text,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'legacy Tournament runtime grants were not restored';
  END IF;

  IF to_regprocedure(
    'dna.list_complete_tournament_configurations(uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'canonical Tournament read API was removed by reversal';
  END IF;
END
$assert_restored$;

ROLLBACK;
