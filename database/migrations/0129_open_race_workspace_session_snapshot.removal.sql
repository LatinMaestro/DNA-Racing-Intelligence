DO $removal$
BEGIN
  IF to_regclass('dna.open_race_workspace_session_snapshot') IS NOT NULL
    OR to_regprocedure('dna.read_open_race_workspace_sessions(uuid,integer)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Open Race workspace session snapshot removal incomplete';
  END IF;
END
$removal$;
