DO $normalized_artifact_removal$
BEGIN
  IF to_regclass('dna.normalized_analytical_artifact') IS NOT NULL THEN
    RAISE EXCEPTION 'normalized analytical artifact table still exists';
  END IF;

  IF to_regprocedure(
    'dna.register_normalized_analytical_artifact(uuid,uuid,text,text,character,bigint,bigint,bigint,bigint,bigint,character,timestamp with time zone,timestamp with time zone,timestamp with time zone)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'normalized analytical artifact registration still exists';
  END IF;

  IF to_regprocedure(
    'dna.bind_normalized_analytical_artifact(uuid,uuid,uuid,timestamp with time zone)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'normalized analytical artifact binding still exists';
  END IF;

  IF to_regprocedure(
    'dna.rollback_normalized_analytical_artifact(uuid,uuid,timestamp with time zone)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'normalized analytical artifact rollback still exists';
  END IF;
END
$normalized_artifact_removal$;
