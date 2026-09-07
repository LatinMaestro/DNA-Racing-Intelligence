BEGIN;

CREATE TABLE dna.pro_league_roster_version (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  roster_version_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  ruleset_id text NOT NULL,
  strategy_id text NOT NULL,
  initial_roster_counting_policy text NOT NULL CHECK (
    initial_roster_counting_policy IN (
      'unresolved', 'counts_toward_annual_limit', 'does_not_count'
    )
  ),
  evidence_cutoff_at timestamptz NOT NULL,
  rationale text NOT NULL,
  version_sha256 text NOT NULL CHECK (version_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, roster_version_id),
  UNIQUE (owner_id, version_number),
  CHECK (length(roster_version_id) BETWEEN 1 AND 128),
  CHECK (roster_version_id !~ '[[:cntrl:]]'),
  CHECK (length(ruleset_id) BETWEEN 1 AND 256),
  CHECK (length(strategy_id) BETWEEN 1 AND 256),
  CHECK (length(rationale) BETWEEN 1 AND 2000)
);

CREATE TABLE dna.pro_league_roster_member_snapshot (
  owner_id uuid NOT NULL,
  roster_version_id text NOT NULL,
  source_core_id text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('rostered', 'alternate')),
  roster_role text NOT NULL CHECK (roster_role IN (
    'nucleus', 'optional', 'structural_coverage', 'marginal', 'alternate'
  )),
  position integer NOT NULL CHECK (position BETWEEN 1 AND 100),
  display_name text NOT NULL,
  element text NOT NULL CHECK (element IN ('Metal', 'Fire', 'Earth', 'Water')),
  core_class text NOT NULL CHECK (
    core_class IN ('Genesis', 'Morphed', 'Freak', 'X-Class')
  ),
  sex text NOT NULL CHECK (sex IN ('male', 'female')),
  f_number integer NOT NULL CHECK (f_number BETWEEN 1 AND 1000000),
  selection_reason text NOT NULL,
  evidence_as_of timestamptz NOT NULL,
  evidence_generation_id text NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_confidence text NOT NULL CHECK (
    evidence_confidence IN ('strong', 'moderate', 'limited', 'unavailable')
  ),
  PRIMARY KEY (owner_id, roster_version_id, source_core_id),
  UNIQUE (owner_id, roster_version_id, disposition, position),
  FOREIGN KEY (owner_id, roster_version_id)
    REFERENCES dna.pro_league_roster_version(owner_id, roster_version_id)
    ON DELETE CASCADE,
  CHECK (length(source_core_id) BETWEEN 1 AND 256),
  CHECK (source_core_id !~ '[[:cntrl:]]'),
  CHECK (length(display_name) BETWEEN 1 AND 512),
  CHECK (length(selection_reason) BETWEEN 1 AND 2000),
  CHECK (length(evidence_generation_id) BETWEEN 1 AND 128),
  CHECK ((disposition = 'alternate') = (roster_role = 'alternate'))
);

CREATE TABLE dna.pro_league_roster_substitution (
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2026 AND 9999),
  substitution_number integer NOT NULL CHECK (substitution_number BETWEEN 1 AND 10),
  from_roster_version_id text NOT NULL,
  to_roster_version_id text NOT NULL,
  outgoing_core_id text NOT NULL,
  incoming_core_id text NOT NULL,
  reason text NOT NULL,
  evidence_as_of timestamptz NOT NULL,
  evidence_generation_id text NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_confidence text NOT NULL CHECK (
    evidence_confidence IN ('strong', 'moderate', 'limited', 'unavailable')
  ),
  substitution_sha256 text NOT NULL CHECK (
    substitution_sha256 ~ '^[a-f0-9]{64}$'
  ),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, season_year, substitution_number),
  UNIQUE (owner_id, substitution_sha256),
  FOREIGN KEY (owner_id, from_roster_version_id)
    REFERENCES dna.pro_league_roster_version(owner_id, roster_version_id),
  FOREIGN KEY (owner_id, to_roster_version_id)
    REFERENCES dna.pro_league_roster_version(owner_id, roster_version_id),
  CHECK (from_roster_version_id <> to_roster_version_id),
  CHECK (outgoing_core_id <> incoming_core_id),
  CHECK (length(reason) BETWEEN 1 AND 2000),
  CHECK (length(evidence_generation_id) BETWEEN 1 AND 128)
);

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'pro_league_roster_version',
    'pro_league_roster_member_snapshot',
    'pro_league_roster_substitution'
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

CREATE FUNCTION dna.store_pro_league_roster_version(
  p_owner_id uuid,
  p_roster_version_id text,
  p_version_number integer,
  p_ruleset_id text,
  p_strategy_id text,
  p_initial_roster_counting_policy text,
  p_evidence_cutoff_at timestamptz,
  p_rationale text,
  p_version_sha256 text,
  p_members jsonb
)
RETURNS TABLE (disposition text, rostered_core_count integer, alternate_core_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing_sha text;
  v_total integer;
  v_rostered integer;
  v_alternates integer;
  v_females integer;
  v_f5 integer;
  v_f10 integer;
  v_above_f15 integer;
  v_expected_version integer;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League roster version write denied';
  END IF;
  IF p_roster_version_id IS NULL OR btrim(p_roster_version_id) = ''
     OR length(btrim(p_roster_version_id)) > 128
     OR p_version_number IS NULL OR p_version_number < 1
     OR p_ruleset_id <> 'dna-pro-league/owner-confirmed-2026-08-31'
     OR p_strategy_id <> 'owner-pro-league/ageing-aware-25-core-2026-08-31'
     OR p_initial_roster_counting_policy NOT IN (
       'unresolved', 'counts_toward_annual_limit', 'does_not_count'
     )
     OR p_evidence_cutoff_at IS NULL
     OR p_rationale IS NULL OR length(btrim(p_rationale)) NOT BETWEEN 1 AND 2000
     OR p_version_sha256 !~ '^[a-f0-9]{64}$'
     OR p_members IS NULL OR jsonb_typeof(p_members) <> 'array'
     OR jsonb_array_length(p_members) NOT BETWEEN 12 AND 100 THEN
    RAISE EXCEPTION 'Pro League roster version metadata is invalid';
  END IF;

  SELECT stored.version_sha256 INTO v_existing_sha
  FROM dna.pro_league_roster_version stored
  WHERE stored.owner_id = p_owner_id
    AND stored.roster_version_id = btrim(p_roster_version_id);
  IF FOUND THEN
    IF v_existing_sha <> p_version_sha256 THEN
      RAISE EXCEPTION 'Pro League roster version identity conflicts';
    END IF;
    RETURN QUERY
    SELECT 'existing'::text,
      count(*) FILTER (WHERE member.disposition = 'rostered')::integer,
      count(*) FILTER (WHERE member.disposition = 'alternate')::integer
    FROM dna.pro_league_roster_member_snapshot member
    WHERE member.owner_id = p_owner_id
      AND member.roster_version_id = btrim(p_roster_version_id);
    RETURN;
  END IF;

  SELECT COALESCE(max(stored.version_number), 0) + 1
  INTO v_expected_version
  FROM dna.pro_league_roster_version stored
  WHERE stored.owner_id = p_owner_id;
  IF p_version_number <> v_expected_version THEN
    RAISE EXCEPTION 'Pro League roster version sequence is not contiguous';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_members) entry(value)
    WHERE jsonb_typeof(entry.value) <> 'object'
      OR jsonb_typeof(entry.value -> 'coreId') <> 'string'
      OR jsonb_typeof(entry.value -> 'displayName') <> 'string'
      OR jsonb_typeof(entry.value -> 'element') <> 'string'
      OR jsonb_typeof(entry.value -> 'coreClass') <> 'string'
      OR jsonb_typeof(entry.value -> 'sex') <> 'string'
      OR jsonb_typeof(entry.value -> 'fNumber') <> 'number'
      OR entry.value -> 'inMyVault' <> 'true'::jsonb
      OR jsonb_typeof(entry.value -> 'disposition') <> 'string'
      OR jsonb_typeof(entry.value -> 'role') <> 'string'
      OR jsonb_typeof(entry.value -> 'position') <> 'number'
      OR jsonb_typeof(entry.value -> 'reason') <> 'string'
      OR jsonb_typeof(entry.value -> 'evidence') <> 'object'
      OR jsonb_typeof(entry.value -> 'evidence' -> 'asOf') <> 'string'
      OR jsonb_typeof(entry.value -> 'evidence' -> 'generationId') <> 'string'
      OR jsonb_typeof(entry.value -> 'evidence' -> 'sha256') <> 'string'
      OR jsonb_typeof(entry.value -> 'evidence' -> 'confidence') <> 'string'
  ) THEN
    RAISE EXCEPTION 'Pro League roster member snapshot shape is invalid';
  END IF;

  WITH members AS (
    SELECT * FROM jsonb_to_recordset(p_members) AS member(
      "coreId" text, "displayName" text, element text, "coreClass" text,
      sex text, "fNumber" integer, "inMyVault" boolean,
      disposition text, role text, position integer, reason text,
      evidence jsonb
    )
  )
  SELECT count(*)::integer,
    count(*) FILTER (WHERE m.disposition = 'rostered')::integer,
    count(*) FILTER (WHERE m.disposition = 'alternate')::integer,
    count(*) FILTER (WHERE m.disposition = 'rostered' AND m.sex = 'female')::integer,
    count(*) FILTER (WHERE m.disposition = 'rostered' AND m."fNumber" <= 5)::integer,
    count(*) FILTER (WHERE m.disposition = 'rostered' AND m."fNumber" <= 10)::integer,
    count(*) FILTER (WHERE m.disposition = 'rostered' AND m."fNumber" > 15)::integer
  INTO v_total, v_rostered, v_alternates, v_females, v_f5, v_f10, v_above_f15
  FROM members m;

  IF v_rostered NOT BETWEEN 12 AND 25 OR v_females < ceil(v_rostered * 0.32)
     OR v_f5 > 5 OR v_f10 > 12 OR v_above_f15 < 2 THEN
    RAISE EXCEPTION 'Pro League roster version violates current roster totals';
  END IF;

  IF EXISTS (
    WITH members AS (
      SELECT * FROM jsonb_to_recordset(p_members) AS member(
        "coreId" text, "displayName" text, element text, "coreClass" text,
        sex text, "fNumber" integer, "inMyVault" boolean,
        disposition text, role text, position integer, reason text,
        evidence jsonb
      )
    )
    SELECT 1 FROM members m
    WHERE length(btrim(m."coreId")) NOT BETWEEN 1 AND 256
      OR m."coreId" ~ '[[:cntrl:]]'
      OR length(btrim(m."displayName")) NOT BETWEEN 1 AND 512
      OR m.element NOT IN ('Metal', 'Fire', 'Earth', 'Water')
      OR m."coreClass" NOT IN ('Genesis', 'Morphed', 'Freak', 'X-Class')
      OR m.sex NOT IN ('male', 'female')
      OR m."fNumber" NOT BETWEEN 1 AND 1000000
      OR m."inMyVault" IS DISTINCT FROM true
      OR m.disposition NOT IN ('rostered', 'alternate')
      OR m.role NOT IN (
        'nucleus', 'optional', 'structural_coverage', 'marginal', 'alternate'
      )
      OR (m.disposition = 'alternate') <> (m.role = 'alternate')
      OR m.position NOT BETWEEN 1 AND 100
      OR length(btrim(m.reason)) NOT BETWEEN 1 AND 2000
      OR length(btrim(m.evidence ->> 'generationId')) NOT BETWEEN 1 AND 128
      OR m.evidence ->> 'sha256' !~ '^[a-f0-9]{64}$'
      OR m.evidence ->> 'confidence' NOT IN (
        'strong', 'moderate', 'limited', 'unavailable'
      )
      OR (m.evidence ->> 'asOf')::timestamptz > p_evidence_cutoff_at
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_members) AS m("coreId" text)
    GROUP BY btrim(m."coreId") HAVING count(*) <> 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_members) AS m(
      disposition text, position integer
    ) GROUP BY m.disposition, m.position HAVING count(*) <> 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_members) AS m(
      disposition text, position integer
    ) GROUP BY m.disposition
    HAVING min(m.position) <> 1 OR max(m.position) <> count(*)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_members) AS m(
      disposition text, element text
    ) WHERE m.disposition = 'rostered'
    GROUP BY m.element HAVING count(*) > CASE m.element
      WHEN 'Metal' THEN 7 WHEN 'Fire' THEN 8 WHEN 'Earth' THEN 10 ELSE 25 END
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_members) AS m(
      disposition text, element text, "coreClass" text
    ) WHERE m.disposition = 'rostered' AND m."coreClass" = 'Genesis'
    GROUP BY m.element HAVING count(*) > 2
  ) THEN
    RAISE EXCEPTION 'Pro League roster member snapshot violates current authority';
  END IF;

  INSERT INTO dna.pro_league_roster_version (
    owner_id, roster_version_id, version_number, ruleset_id, strategy_id,
    initial_roster_counting_policy, evidence_cutoff_at, rationale, version_sha256
  ) VALUES (
    p_owner_id, btrim(p_roster_version_id), p_version_number, p_ruleset_id,
    p_strategy_id, p_initial_roster_counting_policy, p_evidence_cutoff_at,
    btrim(p_rationale), p_version_sha256
  );

  INSERT INTO dna.pro_league_roster_member_snapshot (
    owner_id, roster_version_id, source_core_id, disposition, roster_role,
    position, display_name, element, core_class, sex, f_number,
    selection_reason, evidence_as_of, evidence_generation_id,
    evidence_sha256, evidence_confidence
  )
  SELECT p_owner_id, btrim(p_roster_version_id), btrim(member."coreId"),
    member.disposition, member.role, member.position, btrim(member."displayName"),
    member.element, member."coreClass", member.sex, member."fNumber",
    btrim(member.reason), (member.evidence ->> 'asOf')::timestamptz,
    btrim(member.evidence ->> 'generationId'), member.evidence ->> 'sha256',
    member.evidence ->> 'confidence'
  FROM jsonb_to_recordset(p_members) AS member(
    "coreId" text, "displayName" text, element text, "coreClass" text,
    sex text, "fNumber" integer, "inMyVault" boolean,
    disposition text, role text, position integer, reason text, evidence jsonb
  );

  RETURN QUERY SELECT 'created'::text, v_rostered, v_alternates;
END
$function$;

CREATE FUNCTION dna.read_pro_league_roster_version(
  p_owner_id uuid,
  p_roster_version_id text
)
RETURNS TABLE (
  roster_version_id text,
  version_number integer,
  ruleset_id text,
  strategy_id text,
  initial_roster_counting_policy text,
  evidence_cutoff_at timestamptz,
  rationale text,
  version_sha256 text,
  created_at timestamptz,
  members jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League roster version read denied';
  END IF;
  RETURN QUERY
  SELECT version.roster_version_id, version.version_number,
    version.ruleset_id, version.strategy_id,
    version.initial_roster_counting_policy, version.evidence_cutoff_at,
    version.rationale, version.version_sha256, version.created_at,
    COALESCE(jsonb_agg(jsonb_build_object(
      'coreId', member.source_core_id,
      'displayName', member.display_name,
      'element', member.element,
      'coreClass', member.core_class,
      'sex', member.sex,
      'fNumber', member.f_number,
      'inMyVault', true,
      'disposition', member.disposition,
      'role', member.roster_role,
      'position', member.position,
      'reason', member.selection_reason,
      'evidence', jsonb_build_object(
        'asOf', to_char(member.evidence_as_of AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'generationId', member.evidence_generation_id,
        'sha256', member.evidence_sha256,
        'confidence', member.evidence_confidence
      )
    ) ORDER BY member.disposition DESC, member.position), '[]'::jsonb)
  FROM dna.pro_league_roster_version version
  LEFT JOIN dna.pro_league_roster_member_snapshot member
    ON member.owner_id = version.owner_id
    AND member.roster_version_id = version.roster_version_id
  WHERE version.owner_id = p_owner_id
    AND version.roster_version_id = btrim(p_roster_version_id)
  GROUP BY version.owner_id, version.roster_version_id;
END
$function$;

CREATE FUNCTION dna.record_pro_league_roster_substitution(
  p_owner_id uuid,
  p_season_year integer,
  p_substitution_number integer,
  p_from_roster_version_id text,
  p_to_roster_version_id text,
  p_outgoing_core_id text,
  p_incoming_core_id text,
  p_reason text,
  p_evidence_as_of timestamptz,
  p_evidence_generation_id text,
  p_evidence_sha256 text,
  p_evidence_confidence text,
  p_substitution_sha256 text
)
RETURNS TABLE (disposition text, substitution_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_existing_sha text;
  v_expected_number integer;
  v_from_number integer;
  v_to_number integer;
  v_to_cutoff timestamptz;
  v_outgoing text[];
  v_incoming text[];
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League substitution write denied';
  END IF;
  IF p_season_year NOT BETWEEN 2026 AND 9999
     OR p_substitution_number NOT BETWEEN 1 AND 10
     OR p_from_roster_version_id IS NULL OR p_to_roster_version_id IS NULL
     OR p_from_roster_version_id = p_to_roster_version_id
     OR p_outgoing_core_id IS NULL OR p_incoming_core_id IS NULL
     OR p_outgoing_core_id = p_incoming_core_id
     OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000
     OR p_evidence_as_of IS NULL
     OR length(btrim(p_evidence_generation_id)) NOT BETWEEN 1 AND 128
     OR p_evidence_sha256 !~ '^[a-f0-9]{64}$'
     OR p_evidence_confidence NOT IN ('strong','moderate','limited','unavailable')
     OR p_substitution_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Pro League substitution is invalid';
  END IF;

  SELECT stored.substitution_sha256 INTO v_existing_sha
  FROM dna.pro_league_roster_substitution stored
  WHERE stored.owner_id = p_owner_id
    AND stored.season_year = p_season_year
    AND stored.substitution_number = p_substitution_number;
  IF FOUND THEN
    IF v_existing_sha <> p_substitution_sha256 THEN
      RAISE EXCEPTION 'Pro League substitution identity conflicts';
    END IF;
    RETURN QUERY SELECT 'existing'::text, p_substitution_number;
    RETURN;
  END IF;

  SELECT COALESCE(max(stored.substitution_number), 0) + 1
  INTO v_expected_number
  FROM dna.pro_league_roster_substitution stored
  WHERE stored.owner_id = p_owner_id AND stored.season_year = p_season_year;
  IF p_substitution_number <> v_expected_number THEN
    RAISE EXCEPTION 'Pro League substitution ledger is not contiguous';
  END IF;

  SELECT version.version_number INTO STRICT v_from_number
  FROM dna.pro_league_roster_version version
  WHERE version.owner_id = p_owner_id
    AND version.roster_version_id = p_from_roster_version_id;
  SELECT version.version_number, version.evidence_cutoff_at
  INTO STRICT v_to_number, v_to_cutoff
  FROM dna.pro_league_roster_version version
  WHERE version.owner_id = p_owner_id
    AND version.roster_version_id = p_to_roster_version_id;
  IF v_to_number <> v_from_number + 1 OR p_evidence_as_of > v_to_cutoff THEN
    RAISE EXCEPTION 'Pro League substitution version authority is invalid';
  END IF;

  SELECT array_agg(before.source_core_id ORDER BY before.source_core_id)
  INTO v_outgoing
  FROM dna.pro_league_roster_member_snapshot before
  WHERE before.owner_id = p_owner_id
    AND before.roster_version_id = p_from_roster_version_id
    AND before.disposition = 'rostered'
    AND NOT EXISTS (
      SELECT 1 FROM dna.pro_league_roster_member_snapshot after
      WHERE after.owner_id = p_owner_id
        AND after.roster_version_id = p_to_roster_version_id
        AND after.disposition = 'rostered'
        AND after.source_core_id = before.source_core_id
    );
  SELECT array_agg(after.source_core_id ORDER BY after.source_core_id)
  INTO v_incoming
  FROM dna.pro_league_roster_member_snapshot after
  WHERE after.owner_id = p_owner_id
    AND after.roster_version_id = p_to_roster_version_id
    AND after.disposition = 'rostered'
    AND NOT EXISTS (
      SELECT 1 FROM dna.pro_league_roster_member_snapshot before
      WHERE before.owner_id = p_owner_id
        AND before.roster_version_id = p_from_roster_version_id
        AND before.disposition = 'rostered'
        AND before.source_core_id = after.source_core_id
    );
  IF COALESCE(cardinality(v_outgoing), 0) <> 1
     OR COALESCE(cardinality(v_incoming), 0) <> 1
     OR v_outgoing[1] <> p_outgoing_core_id
     OR v_incoming[1] <> p_incoming_core_id THEN
    RAISE EXCEPTION 'Pro League substitution does not match roster versions';
  END IF;

  INSERT INTO dna.pro_league_roster_substitution (
    owner_id, season_year, substitution_number, from_roster_version_id,
    to_roster_version_id, outgoing_core_id, incoming_core_id, reason,
    evidence_as_of, evidence_generation_id, evidence_sha256,
    evidence_confidence, substitution_sha256
  ) VALUES (
    p_owner_id, p_season_year, p_substitution_number,
    p_from_roster_version_id, p_to_roster_version_id,
    p_outgoing_core_id, p_incoming_core_id, btrim(p_reason),
    p_evidence_as_of, btrim(p_evidence_generation_id), p_evidence_sha256,
    p_evidence_confidence, p_substitution_sha256
  );
  RETURN QUERY SELECT 'created'::text, p_substitution_number;
END
$function$;

CREATE FUNCTION dna.list_pro_league_roster_substitutions(
  p_owner_id uuid,
  p_season_year integer
)
RETURNS SETOF dna.pro_league_roster_substitution
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped Pro League substitution read denied';
  END IF;
  RETURN QUERY SELECT stored.*
  FROM dna.pro_league_roster_substitution stored
  WHERE stored.owner_id = p_owner_id AND stored.season_year = p_season_year
  ORDER BY stored.substitution_number;
END
$function$;

REVOKE ALL ON TABLE dna.pro_league_roster_version FROM PUBLIC;
REVOKE ALL ON TABLE dna.pro_league_roster_member_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE dna.pro_league_roster_substitution FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.store_pro_league_roster_version(
  uuid,text,integer,text,text,text,timestamptz,text,text,jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_pro_league_roster_version(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.record_pro_league_roster_substitution(
  uuid,integer,integer,text,text,text,text,text,timestamptz,text,text,text,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.list_pro_league_roster_substitutions(uuid,integer)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dna.store_pro_league_roster_version(
  uuid,text,integer,text,text,text,timestamptz,text,text,jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_pro_league_roster_version(uuid,text)
  TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.record_pro_league_roster_substitution(
  uuid,integer,integer,text,text,text,text,text,timestamptz,text,text,text,text
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.list_pro_league_roster_substitutions(uuid,integer)
  TO dna_app_runtime;

COMMIT;
