BEGIN;

CREATE TABLE dna.pro_league_lineup_version (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  lineup_version_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  roster_version_id text NOT NULL,
  authority_id text NOT NULL,
  map_catalogue_id text NOT NULL,
  rationale text NOT NULL,
  version_sha256 text NOT NULL CHECK (version_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, lineup_version_id),
  UNIQUE (owner_id, version_number),
  FOREIGN KEY (owner_id, roster_version_id)
    REFERENCES dna.pro_league_roster_version(owner_id, roster_version_id),
  CHECK (length(lineup_version_id) BETWEEN 1 AND 128),
  CHECK (length(authority_id) BETWEEN 1 AND 256),
  CHECK (length(map_catalogue_id) BETWEEN 1 AND 256),
  CHECK (length(rationale) BETWEEN 1 AND 2000)
);

CREATE TABLE dna.pro_league_lineup_entry_snapshot (
  owner_id uuid NOT NULL,
  lineup_version_id text NOT NULL,
  roster_version_id text NOT NULL,
  map_id text NOT NULL CHECK (map_id IN ('map-1','map-2','map-3','map-4')),
  race_number integer NOT NULL CHECK (race_number BETWEEN 1 AND 42),
  race_type text NOT NULL,
  distance_metres integer NOT NULL CHECK (distance_metres > 0),
  total_gate_entries integer NOT NULL CHECK (total_gate_entries > 0),
  gate_entries_per_vault integer NOT NULL CHECK (gate_entries_per_vault > 0),
  source_core_id text NOT NULL,
  source_race_number integer NOT NULL CHECK (source_race_number BETWEEN 1 AND 42),
  assignment_scope text NOT NULL CHECK (
    assignment_scope IN ('single_race','same_type_and_distance')
  ),
  PRIMARY KEY (owner_id, lineup_version_id, map_id, race_number),
  FOREIGN KEY (owner_id, lineup_version_id)
    REFERENCES dna.pro_league_lineup_version(owner_id, lineup_version_id)
    ON DELETE CASCADE,
  FOREIGN KEY (owner_id, roster_version_id, source_core_id)
    REFERENCES dna.pro_league_roster_member_snapshot(
      owner_id, roster_version_id, source_core_id
    ),
  CHECK (total_gate_entries = gate_entries_per_vault * 2),
  CHECK (length(race_type) BETWEEN 1 AND 128),
  CHECK (length(source_core_id) BETWEEN 1 AND 256)
);

CREATE TABLE dna.pro_league_match_lock (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  match_lock_id text NOT NULL,
  match_id text NOT NULL,
  lineup_version_id text NOT NULL,
  roster_version_id text NOT NULL,
  our_vault_id text NOT NULL,
  home_vault_id text NOT NULL,
  away_vault_id text NOT NULL,
  our_side text NOT NULL CHECK (our_side IN ('home','away')),
  scheduled_at timestamptz NOT NULL,
  locked_at timestamptz NOT NULL,
  ruleset_source text NOT NULL,
  third_map_policy text NOT NULL CHECK (
    third_map_policy IN (
      'denied_map_excluded','denied_map_returns_to_random_pool'
    )
  ),
  home_map_pick text NOT NULL CHECK (home_map_pick IN ('map-1','map-2','map-3','map-4')),
  home_denied_map text NOT NULL CHECK (home_denied_map IN ('map-1','map-2','map-3','map-4')),
  away_map_pick text NOT NULL CHECK (away_map_pick IN ('map-1','map-2','map-3','map-4')),
  third_map text NOT NULL CHECK (third_map IN ('map-1','map-2','map-3','map-4')),
  fallback_source text CHECK (
    fallback_source IN ('official_match_page','owner_recorded','trial_missed_pick')
  ),
  fallback_reference text,
  match_lock_sha256 text NOT NULL CHECK (match_lock_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, match_lock_id),
  UNIQUE (owner_id, match_id),
  FOREIGN KEY (owner_id, lineup_version_id)
    REFERENCES dna.pro_league_lineup_version(owner_id, lineup_version_id),
  FOREIGN KEY (owner_id, roster_version_id)
    REFERENCES dna.pro_league_roster_version(owner_id, roster_version_id),
  CHECK (home_vault_id <> away_vault_id),
  CHECK ((our_side = 'home' AND our_vault_id = home_vault_id)
      OR (our_side = 'away' AND our_vault_id = away_vault_id)),
  CHECK (locked_at <= scheduled_at),
  CHECK (home_map_pick <> home_denied_map),
  CHECK (away_map_pick <> home_map_pick AND away_map_pick <> home_denied_map),
  CHECK ((fallback_source IS NULL) = (fallback_reference IS NULL)),
  CHECK (fallback_reference IS NULL OR length(fallback_reference) BETWEEN 1 AND 512),
  CHECK (length(ruleset_source) BETWEEN 1 AND 512)
);

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'pro_league_lineup_version',
    'pro_league_lineup_entry_snapshot',
    'pro_league_match_lock'
  ] LOOP
    EXECUTE format('ALTER TABLE dna.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE dna.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY owner_isolation ON dna.%I USING (owner_id = dna.current_owner_id()) WITH CHECK (owner_id = dna.current_owner_id())',
      v_table
    );
  END LOOP;
END
$rls$;

CREATE FUNCTION dna.store_pro_league_lineup_version(
  p_owner_id uuid,
  p_lineup_version_id text,
  p_version_number integer,
  p_roster_version_id text,
  p_authority_id text,
  p_map_catalogue_id text,
  p_rationale text,
  p_version_sha256 text,
  p_entries jsonb
)
RETURNS TABLE (disposition text, entry_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing_sha text;
  v_expected_version integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League lineup write denied';
  END IF;
  IF length(btrim(p_lineup_version_id)) NOT BETWEEN 1 AND 128
     OR p_version_number IS NULL OR p_version_number < 1
     OR length(btrim(p_roster_version_id)) NOT BETWEEN 1 AND 128
     OR p_authority_id <> 'dna-pro-league/lineup-lock-2026-08-29'
     OR p_map_catalogue_id <> 'dna-pro-league/maps-observed-2026-08-29'
     OR length(btrim(p_rationale)) NOT BETWEEN 1 AND 2000
     OR p_version_sha256 !~ '^[a-f0-9]{64}$'
     OR p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array'
     OR jsonb_array_length(p_entries) <> 168 THEN
    RAISE EXCEPTION 'Pro League lineup version metadata is invalid';
  END IF;

  SELECT stored.version_sha256 INTO v_existing_sha
  FROM dna.pro_league_lineup_version stored
  WHERE stored.owner_id = p_owner_id
    AND stored.lineup_version_id = btrim(p_lineup_version_id);
  IF FOUND THEN
    IF v_existing_sha <> p_version_sha256 THEN
      RAISE EXCEPTION 'Pro League lineup version identity conflicts';
    END IF;
    RETURN QUERY SELECT 'existing'::text, count(*)::integer
    FROM dna.pro_league_lineup_entry_snapshot entry
    WHERE entry.owner_id = p_owner_id
      AND entry.lineup_version_id = btrim(p_lineup_version_id);
    RETURN;
  END IF;

  SELECT COALESCE(max(stored.version_number), 0) + 1 INTO v_expected_version
  FROM dna.pro_league_lineup_version stored WHERE stored.owner_id = p_owner_id;
  IF p_version_number <> v_expected_version THEN
    RAISE EXCEPTION 'Pro League lineup version sequence is not contiguous';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dna.pro_league_roster_version roster
    WHERE roster.owner_id = p_owner_id
      AND roster.roster_version_id = btrim(p_roster_version_id)
  ) THEN
    RAISE EXCEPTION 'Pro League lineup roster version does not exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_entries) item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
      OR jsonb_typeof(item.value -> 'mapId') <> 'string'
      OR jsonb_typeof(item.value -> 'raceNumber') <> 'number'
      OR jsonb_typeof(item.value -> 'raceType') <> 'string'
      OR jsonb_typeof(item.value -> 'distanceMetres') <> 'number'
      OR jsonb_typeof(item.value -> 'totalGateEntries') <> 'number'
      OR jsonb_typeof(item.value -> 'gateEntriesPerVault') <> 'number'
      OR jsonb_typeof(item.value -> 'coreId') <> 'string'
      OR jsonb_typeof(item.value -> 'sourceRaceNumber') <> 'number'
      OR jsonb_typeof(item.value -> 'scope') <> 'string'
  ) THEN
    RAISE EXCEPTION 'Pro League lineup entry shape is invalid';
  END IF;
  IF EXISTS (
    WITH entries AS (
      SELECT * FROM jsonb_to_recordset(p_entries) AS entry(
        "mapId" text, "raceNumber" integer, "raceType" text,
        "distanceMetres" integer, "totalGateEntries" integer,
        "gateEntriesPerVault" integer, "coreId" text,
        "sourceRaceNumber" integer, scope text
      )
    )
    SELECT 1 FROM entries entry
    WHERE entry."mapId" NOT IN ('map-1','map-2','map-3','map-4')
      OR entry."raceNumber" NOT BETWEEN 1 AND 42
      OR length(btrim(entry."raceType")) NOT BETWEEN 1 AND 128
      OR entry."distanceMetres" <= 0
      OR entry."totalGateEntries" <= 0
      OR entry."gateEntriesPerVault" * 2 <> entry."totalGateEntries"
      OR length(btrim(entry."coreId")) NOT BETWEEN 1 AND 256
      OR entry."sourceRaceNumber" NOT BETWEEN 1 AND 42
      OR entry.scope NOT IN ('single_race','same_type_and_distance')
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_entries) AS entry(
      "mapId" text, "raceNumber" integer
    ) GROUP BY entry."mapId", entry."raceNumber" HAVING count(*) <> 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_entries) AS entry(
      "mapId" text, "raceNumber" integer
    ) GROUP BY entry."mapId"
      HAVING count(*) <> 42 OR min(entry."raceNumber") <> 1
        OR max(entry."raceNumber") <> 42
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_entries) AS entry("coreId" text)
    WHERE NOT EXISTS (
      SELECT 1 FROM dna.pro_league_roster_member_snapshot member
      WHERE member.owner_id = p_owner_id
        AND member.roster_version_id = btrim(p_roster_version_id)
        AND member.source_core_id = btrim(entry."coreId")
        AND member.disposition = 'rostered'
    )
  ) THEN
    RAISE EXCEPTION 'Pro League lineup entries violate current authority';
  END IF;

  INSERT INTO dna.pro_league_lineup_version (
    owner_id, lineup_version_id, version_number, roster_version_id,
    authority_id, map_catalogue_id, rationale, version_sha256
  ) VALUES (
    p_owner_id, btrim(p_lineup_version_id), p_version_number,
    btrim(p_roster_version_id), p_authority_id, p_map_catalogue_id,
    btrim(p_rationale), p_version_sha256
  );
  INSERT INTO dna.pro_league_lineup_entry_snapshot (
    owner_id, lineup_version_id, roster_version_id, map_id, race_number,
    race_type, distance_metres, total_gate_entries, gate_entries_per_vault,
    source_core_id, source_race_number, assignment_scope
  )
  SELECT p_owner_id, btrim(p_lineup_version_id), btrim(p_roster_version_id),
    entry."mapId", entry."raceNumber", btrim(entry."raceType"),
    entry."distanceMetres", entry."totalGateEntries",
    entry."gateEntriesPerVault", btrim(entry."coreId"),
    entry."sourceRaceNumber", entry.scope
  FROM jsonb_to_recordset(p_entries) AS entry(
    "mapId" text, "raceNumber" integer, "raceType" text,
    "distanceMetres" integer, "totalGateEntries" integer,
    "gateEntriesPerVault" integer, "coreId" text,
    "sourceRaceNumber" integer, scope text
  );
  RETURN QUERY SELECT 'created'::text, 168;
END
$function$;

CREATE FUNCTION dna.read_pro_league_lineup_version(uuid,text)
RETURNS TABLE (
  lineup_version_id text, version_number integer, roster_version_id text,
  authority_id text, map_catalogue_id text, rationale text,
  version_sha256 text, created_at timestamptz, entries jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR $1 <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League lineup read denied';
  END IF;
  RETURN QUERY SELECT version.lineup_version_id, version.version_number,
    version.roster_version_id, version.authority_id, version.map_catalogue_id,
    version.rationale, version.version_sha256, version.created_at,
    COALESCE(jsonb_agg(jsonb_build_object(
      'mapId', entry.map_id, 'raceNumber', entry.race_number,
      'raceType', entry.race_type, 'distanceMetres', entry.distance_metres,
      'totalGateEntries', entry.total_gate_entries,
      'gateEntriesPerVault', entry.gate_entries_per_vault,
      'coreId', entry.source_core_id,
      'sourceRaceNumber', entry.source_race_number,
      'scope', entry.assignment_scope
    ) ORDER BY entry.map_id, entry.race_number), '[]'::jsonb)
  FROM dna.pro_league_lineup_version version
  LEFT JOIN dna.pro_league_lineup_entry_snapshot entry
    ON entry.owner_id = version.owner_id
    AND entry.lineup_version_id = version.lineup_version_id
  WHERE version.owner_id = $1 AND version.lineup_version_id = btrim($2)
  GROUP BY version.owner_id, version.lineup_version_id;
END
$function$;

CREATE FUNCTION dna.store_pro_league_match_lock(
  p_owner_id uuid, p_match_lock_id text, p_match_id text,
  p_lineup_version_id text, p_roster_version_id text,
  p_our_vault_id text, p_home_vault_id text, p_away_vault_id text,
  p_our_side text, p_scheduled_at timestamptz, p_locked_at timestamptz,
  p_ruleset_source text, p_third_map_policy text, p_home_map_pick text,
  p_home_denied_map text, p_away_map_pick text, p_third_map text,
  p_fallback_source text, p_fallback_reference text, p_match_lock_sha256 text
)
RETURNS TABLE (disposition text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing_sha text;
  v_bound_roster text;
  v_expected_third text;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League match lock write denied';
  END IF;
  IF length(btrim(p_match_lock_id)) NOT BETWEEN 1 AND 128
     OR length(btrim(p_match_id)) NOT BETWEEN 1 AND 128
     OR length(btrim(p_lineup_version_id)) NOT BETWEEN 1 AND 128
     OR length(btrim(p_roster_version_id)) NOT BETWEEN 1 AND 128
     OR length(btrim(p_our_vault_id)) NOT BETWEEN 1 AND 128
     OR length(btrim(p_home_vault_id)) NOT BETWEEN 1 AND 128
     OR length(btrim(p_away_vault_id)) NOT BETWEEN 1 AND 128
     OR p_home_vault_id = p_away_vault_id
     OR NOT ((p_our_side = 'home' AND p_our_vault_id = p_home_vault_id)
          OR (p_our_side = 'away' AND p_our_vault_id = p_away_vault_id))
     OR p_locked_at > p_scheduled_at
     OR length(btrim(p_ruleset_source)) NOT BETWEEN 1 AND 512
     OR p_third_map_policy NOT IN (
       'denied_map_excluded','denied_map_returns_to_random_pool'
     )
     OR p_home_map_pick NOT IN ('map-1','map-2','map-3','map-4')
     OR p_home_denied_map NOT IN ('map-1','map-2','map-3','map-4')
     OR p_away_map_pick NOT IN ('map-1','map-2','map-3','map-4')
     OR p_third_map NOT IN ('map-1','map-2','map-3','map-4')
     OR p_home_map_pick = p_home_denied_map
     OR p_away_map_pick IN (p_home_map_pick,p_home_denied_map)
     OR (p_fallback_source IS NULL) <> (p_fallback_reference IS NULL)
     OR (p_fallback_source IS NOT NULL AND p_fallback_source NOT IN (
       'official_match_page','owner_recorded','trial_missed_pick'
     ))
     OR (p_fallback_reference IS NOT NULL
       AND length(btrim(p_fallback_reference)) NOT BETWEEN 1 AND 512)
     OR p_match_lock_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Pro League match lock is invalid';
  END IF;
  IF p_third_map_policy = 'denied_map_excluded' THEN
    SELECT map_id INTO v_expected_third
    FROM unnest(ARRAY['map-1','map-2','map-3','map-4']) map_id
    WHERE map_id NOT IN (p_home_map_pick,p_home_denied_map,p_away_map_pick);
    IF p_third_map <> v_expected_third THEN
      RAISE EXCEPTION 'Pro League third map violates excluded-denial policy';
    END IF;
  ELSIF p_third_map IN (p_home_map_pick,p_away_map_pick) THEN
    RAISE EXCEPTION 'Pro League third map violates returned-denial policy';
  END IF;

  SELECT stored.match_lock_sha256 INTO v_existing_sha
  FROM dna.pro_league_match_lock stored
  WHERE stored.owner_id = p_owner_id
    AND stored.match_lock_id = btrim(p_match_lock_id);
  IF FOUND THEN
    IF v_existing_sha <> p_match_lock_sha256 THEN
      RAISE EXCEPTION 'Pro League match lock identity conflicts';
    END IF;
    RETURN QUERY SELECT 'existing'::text;
    RETURN;
  END IF;
  SELECT lineup.roster_version_id INTO STRICT v_bound_roster
  FROM dna.pro_league_lineup_version lineup
  WHERE lineup.owner_id = p_owner_id
    AND lineup.lineup_version_id = btrim(p_lineup_version_id);
  IF v_bound_roster <> btrim(p_roster_version_id) THEN
    RAISE EXCEPTION 'Pro League match lock roster does not match its lineup';
  END IF;
  INSERT INTO dna.pro_league_match_lock (
    owner_id, match_lock_id, match_id, lineup_version_id, roster_version_id,
    our_vault_id, home_vault_id, away_vault_id, our_side,
    scheduled_at, locked_at, ruleset_source, third_map_policy,
    home_map_pick, home_denied_map, away_map_pick, third_map,
    fallback_source, fallback_reference, match_lock_sha256
  ) VALUES (
    p_owner_id, btrim(p_match_lock_id), btrim(p_match_id),
    btrim(p_lineup_version_id), btrim(p_roster_version_id),
    btrim(p_our_vault_id), btrim(p_home_vault_id), btrim(p_away_vault_id),
    p_our_side, p_scheduled_at, p_locked_at, btrim(p_ruleset_source),
    p_third_map_policy, p_home_map_pick, p_home_denied_map,
    p_away_map_pick, p_third_map, p_fallback_source,
    CASE WHEN p_fallback_reference IS NULL THEN NULL
      ELSE btrim(p_fallback_reference) END, p_match_lock_sha256
  );
  RETURN QUERY SELECT 'created'::text;
END
$function$;

CREATE FUNCTION dna.read_pro_league_match_lock(uuid,text)
RETURNS SETOF dna.pro_league_match_lock
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR $1 <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League match lock read denied';
  END IF;
  RETURN QUERY SELECT stored.* FROM dna.pro_league_match_lock stored
  WHERE stored.owner_id = $1 AND stored.match_lock_id = btrim($2);
END
$function$;

REVOKE ALL ON TABLE dna.pro_league_lineup_version FROM PUBLIC;
REVOKE ALL ON TABLE dna.pro_league_lineup_entry_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE dna.pro_league_match_lock FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.store_pro_league_lineup_version(
  uuid,text,integer,text,text,text,text,text,jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_pro_league_lineup_version(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.store_pro_league_match_lock(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,
  text,text,text,text,text,text,text,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_pro_league_match_lock(uuid,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.store_pro_league_lineup_version(
  uuid,text,integer,text,text,text,text,text,jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_pro_league_lineup_version(uuid,text)
  TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.store_pro_league_match_lock(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,
  text,text,text,text,text,text,text,text,text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_pro_league_match_lock(uuid,text)
  TO dna_app_runtime;

COMMIT;
