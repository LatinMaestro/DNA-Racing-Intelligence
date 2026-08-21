DO $runtime_capacity_smoke$
DECLARE
  runtime_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO STRICT runtime_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'dna_app_runtime';

  IF runtime_role.rolconnlimit <> 10
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolsuper
     OR runtime_role.rolcreatedb
     OR runtime_role.rolcreaterole
     OR runtime_role.rolinherit
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION 'runtime role capacity or least-privilege evidence is invalid';
  END IF;
END
$runtime_capacity_smoke$;
