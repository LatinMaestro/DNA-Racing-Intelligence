BEGIN;

DO $assert_retired$
BEGIN
  IF to_regprocedure(
    'dna.list_tournament_configurations(uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'legacy Tournament read API still exists';
  END IF;

  IF to_regprocedure(
    'dna.upsert_tournament_configuration(uuid,text,text,text,text,text,integer[],text,text,text,text,timestamptz)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'legacy Tournament write API still exists';
  END IF;

  IF to_regprocedure(
    'dna.list_complete_tournament_configurations(uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'canonical Tournament read API is missing';
  END IF;

  IF to_regprocedure(
    'dna.upsert_complete_tournament_configuration(uuid,text,text,text,timestamptz,timestamptz,text,text,text,integer[],integer,numeric,text,text,text[],text[],text[],integer[],jsonb,jsonb,text,jsonb,integer,integer,numeric,text,integer,jsonb,jsonb,text,text,text,text,text,jsonb,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'canonical Tournament write API is missing';
  END IF;

  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.list_complete_tournament_configurations(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime cannot execute canonical Tournament read API';
  END IF;
END
$assert_retired$;

ROLLBACK;
