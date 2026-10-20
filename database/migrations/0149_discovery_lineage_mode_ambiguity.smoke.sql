BEGIN;

INSERT INTO dna.app_owner(id, clerk_user_id) VALUES
  ('a1490000-0000-4000-8000-000000000001', 'smoke_discovery_lineage_owner'),
  ('a1490000-0000-4000-8000-000000000002', 'smoke_discovery_lineage_other');

DO $permissions$
BEGIN
  IF NOT has_function_privilege(
    'dna_app_runtime',
    'dna.list_discovery_lineage_hypotheses(uuid, integer)',
    'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc procedure,
      LATERAL aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
    WHERE procedure.oid =
      'dna.list_discovery_lineage_hypotheses(uuid,integer)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Discovery lineage read privileges are unsafe';
  END IF;
END
$permissions$;

\if :{?skip_runtime_role}
\else
SET LOCAL ROLE dna_app_runtime;
\endif
SET LOCAL app.owner_id = 'a1490000-0000-4000-8000-000000000001';

DO $read$
BEGIN
  IF (SELECT count(*) FROM dna.list_discovery_lineage_hypotheses(
    'a1490000-0000-4000-8000-000000000001', 10
  )) <> 0 THEN
    RAISE EXCEPTION 'Empty Discovery lineage read returned unexpected rows';
  END IF;

  BEGIN
    PERFORM dna.list_discovery_lineage_hypotheses(
      'a1490000-0000-4000-8000-000000000002', 10
    );
    RAISE EXCEPTION 'Cross-owner Discovery lineage read accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Cross-owner Discovery lineage read accepted' THEN
      RAISE;
    END IF;
  END;
END
$read$;

\if :{?skip_runtime_role}
\else
RESET ROLE;
\endif
ROLLBACK;
