BEGIN;

CREATE TABLE dna.pro_league_full_gate_plan (
  owner_id uuid NOT NULL,
  lineup_version_id text NOT NULL,
  roster_version_id text NOT NULL,
  plan_id text NOT NULL,
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  assignment_count integer NOT NULL CHECK (assignment_count = 1021),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, lineup_version_id),
  FOREIGN KEY (owner_id, lineup_version_id)
    REFERENCES dna.pro_league_lineup_version(owner_id, lineup_version_id)
    ON DELETE CASCADE,
  FOREIGN KEY (owner_id, roster_version_id)
    REFERENCES dna.pro_league_roster_version(owner_id, roster_version_id),
  CHECK (plan_id = 'owner-final-roster/full-gate-win-first/2026-09-20')
);

CREATE TABLE dna.pro_league_full_gate_assignment_snapshot (
  owner_id uuid NOT NULL,
  lineup_version_id text NOT NULL,
  roster_version_id text NOT NULL,
  map_id text NOT NULL CHECK (map_id IN ('map-1','map-2','map-3','map-4')),
  race_number integer NOT NULL CHECK (race_number BETWEEN 1 AND 42),
  slot_number integer NOT NULL CHECK (slot_number > 0),
  race_type text NOT NULL CHECK (length(race_type) BETWEEN 1 AND 128),
  distance_metres integer NOT NULL CHECK (distance_metres > 0),
  total_gate_entries integer NOT NULL CHECK (total_gate_entries > 0),
  gate_entries_per_vault integer NOT NULL CHECK (gate_entries_per_vault > 0),
  source_core_id text NOT NULL CHECK (length(source_core_id) BETWEEN 1 AND 256),
  PRIMARY KEY (owner_id, lineup_version_id, map_id, race_number, slot_number),
  FOREIGN KEY (owner_id, lineup_version_id)
    REFERENCES dna.pro_league_full_gate_plan(owner_id, lineup_version_id)
    ON DELETE CASCADE,
  FOREIGN KEY (owner_id, roster_version_id, source_core_id)
    REFERENCES dna.pro_league_roster_member_snapshot(
      owner_id, roster_version_id, source_core_id
    ),
  CHECK (total_gate_entries = gate_entries_per_vault * 2),
  CHECK (slot_number <= gate_entries_per_vault)
);

ALTER TABLE dna.pro_league_full_gate_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.pro_league_full_gate_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.pro_league_full_gate_plan
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());
ALTER TABLE dna.pro_league_full_gate_assignment_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.pro_league_full_gate_assignment_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.pro_league_full_gate_assignment_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.store_pro_league_full_gate_plan(
  p_owner_id uuid, p_lineup_version_id text, p_roster_version_id text,
  p_plan_id text, p_plan_sha256 text, p_assignments jsonb
)
RETURNS TABLE (disposition text, assignment_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing_sha text;
  v_bound_roster text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League full-gate write denied';
  END IF;
  IF length(btrim(p_lineup_version_id)) NOT BETWEEN 1 AND 128
     OR length(btrim(p_roster_version_id)) NOT BETWEEN 1 AND 128
     OR p_plan_id <> 'owner-final-roster/full-gate-win-first/2026-09-20'
     OR p_plan_sha256 !~ '^[a-f0-9]{64}$'
     OR p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array'
     OR jsonb_array_length(p_assignments) <> 1021 THEN
    RAISE EXCEPTION 'Pro League full-gate metadata is invalid';
  END IF;
  SELECT lineup.roster_version_id INTO STRICT v_bound_roster
  FROM dna.pro_league_lineup_version lineup
  WHERE lineup.owner_id = p_owner_id
    AND lineup.lineup_version_id = btrim(p_lineup_version_id);
  IF v_bound_roster <> btrim(p_roster_version_id) THEN
    RAISE EXCEPTION 'Pro League full-gate roster does not match lineup';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
      OR jsonb_typeof(item.value -> 'mapId') <> 'string'
      OR jsonb_typeof(item.value -> 'raceNumber') <> 'number'
      OR jsonb_typeof(item.value -> 'slotNumber') <> 'number'
      OR jsonb_typeof(item.value -> 'raceType') <> 'string'
      OR jsonb_typeof(item.value -> 'distanceMetres') <> 'number'
      OR jsonb_typeof(item.value -> 'totalGateEntries') <> 'number'
      OR jsonb_typeof(item.value -> 'gateEntriesPerVault') <> 'number'
      OR jsonb_typeof(item.value -> 'coreId') <> 'string'
  ) THEN RAISE EXCEPTION 'Pro League full-gate assignment shape is invalid'; END IF;
  IF EXISTS (
    WITH assignments AS (
      SELECT * FROM jsonb_to_recordset(p_assignments) AS value(
        "mapId" text, "raceNumber" integer, "slotNumber" integer,
        "raceType" text, "distanceMetres" integer,
        "totalGateEntries" integer, "gateEntriesPerVault" integer,
        "coreId" text
      )
    )
    SELECT 1 FROM assignments value
    LEFT JOIN dna.pro_league_lineup_entry_snapshot line
      ON line.owner_id = p_owner_id
      AND line.lineup_version_id = btrim(p_lineup_version_id)
      AND line.map_id = value."mapId" AND line.race_number = value."raceNumber"
    LEFT JOIN dna.pro_league_roster_member_snapshot member
      ON member.owner_id = p_owner_id
      AND member.roster_version_id = btrim(p_roster_version_id)
      AND member.source_core_id = btrim(value."coreId")
      AND member.disposition = 'rostered'
    WHERE line.owner_id IS NULL OR member.owner_id IS NULL
      OR value."slotNumber" NOT BETWEEN 1 AND value."gateEntriesPerVault"
      OR value."raceType" <> line.race_type
      OR value."distanceMetres" <> line.distance_metres
      OR value."totalGateEntries" <> line.total_gate_entries
      OR value."gateEntriesPerVault" <> line.gate_entries_per_vault
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_assignments) AS value(
      "mapId" text, "raceNumber" integer, "slotNumber" integer
    ) GROUP BY value."mapId", value."raceNumber", value."slotNumber"
    HAVING count(*) <> 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_assignments) AS value(
      "mapId" text, "raceNumber" integer, "slotNumber" integer,
      "gateEntriesPerVault" integer
    ) GROUP BY value."mapId", value."raceNumber", value."gateEntriesPerVault"
    HAVING count(*) <> value."gateEntriesPerVault"
      OR min(value."slotNumber") <> 1
      OR max(value."slotNumber") <> value."gateEntriesPerVault"
  ) THEN RAISE EXCEPTION 'Pro League full-gate assignments violate authority'; END IF;

  SELECT plan.plan_sha256 INTO v_existing_sha
  FROM dna.pro_league_full_gate_plan plan
  WHERE plan.owner_id = p_owner_id
    AND plan.lineup_version_id = btrim(p_lineup_version_id);
  IF FOUND THEN
    IF v_existing_sha <> p_plan_sha256 THEN
      RAISE EXCEPTION 'Pro League full-gate identity conflicts';
    END IF;
    RETURN QUERY SELECT 'existing'::text, count(*)::integer
    FROM dna.pro_league_full_gate_assignment_snapshot assignment
    WHERE assignment.owner_id = p_owner_id
      AND assignment.lineup_version_id = btrim(p_lineup_version_id);
    RETURN;
  END IF;

  INSERT INTO dna.pro_league_full_gate_plan (
    owner_id, lineup_version_id, roster_version_id, plan_id,
    plan_sha256, assignment_count
  ) VALUES (
    p_owner_id, btrim(p_lineup_version_id), btrim(p_roster_version_id),
    p_plan_id, p_plan_sha256, 1021
  );
  INSERT INTO dna.pro_league_full_gate_assignment_snapshot (
    owner_id, lineup_version_id, roster_version_id, map_id, race_number,
    slot_number, race_type, distance_metres, total_gate_entries,
    gate_entries_per_vault, source_core_id
  ) SELECT p_owner_id, btrim(p_lineup_version_id), btrim(p_roster_version_id),
    value."mapId", value."raceNumber", value."slotNumber",
    btrim(value."raceType"), value."distanceMetres", value."totalGateEntries",
    value."gateEntriesPerVault", btrim(value."coreId")
  FROM jsonb_to_recordset(p_assignments) AS value(
    "mapId" text, "raceNumber" integer, "slotNumber" integer,
    "raceType" text, "distanceMetres" integer,
    "totalGateEntries" integer, "gateEntriesPerVault" integer, "coreId" text
  );
  RETURN QUERY SELECT 'created'::text, 1021;
END
$function$;

CREATE FUNCTION dna.read_pro_league_full_gate_plan(uuid,text)
RETURNS TABLE (
  lineup_version_id text, roster_version_id text, plan_id text,
  plan_sha256 text, assignment_count integer, created_at timestamptz,
  assignments jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR $1 <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League full-gate read denied';
  END IF;
  RETURN QUERY SELECT plan.lineup_version_id, plan.roster_version_id,
    plan.plan_id, plan.plan_sha256, plan.assignment_count, plan.created_at,
    COALESCE(jsonb_agg(jsonb_build_object(
      'mapId', assignment.map_id, 'raceNumber', assignment.race_number,
      'slotNumber', assignment.slot_number, 'raceType', assignment.race_type,
      'distanceMetres', assignment.distance_metres,
      'totalGateEntries', assignment.total_gate_entries,
      'gateEntriesPerVault', assignment.gate_entries_per_vault,
      'coreId', assignment.source_core_id
    ) ORDER BY assignment.map_id, assignment.race_number,
      assignment.slot_number), '[]'::jsonb)
  FROM dna.pro_league_full_gate_plan plan
  LEFT JOIN dna.pro_league_full_gate_assignment_snapshot assignment
    ON assignment.owner_id = plan.owner_id
    AND assignment.lineup_version_id = plan.lineup_version_id
  WHERE plan.owner_id = $1 AND plan.lineup_version_id = btrim($2)
  GROUP BY plan.owner_id, plan.lineup_version_id;
END
$function$;

REVOKE ALL ON TABLE dna.pro_league_full_gate_plan FROM PUBLIC;
REVOKE ALL ON TABLE dna.pro_league_full_gate_assignment_snapshot FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.store_pro_league_full_gate_plan(
  uuid,text,text,text,text,jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_pro_league_full_gate_plan(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.store_pro_league_full_gate_plan(
  uuid,text,text,text,text,jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_pro_league_full_gate_plan(uuid,text)
  TO dna_app_runtime;

COMMIT;
