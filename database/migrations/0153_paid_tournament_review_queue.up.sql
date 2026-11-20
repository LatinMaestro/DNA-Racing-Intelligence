BEGIN;

CREATE TABLE dna.paid_tournament_review_queue (
  queue_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES dna.app_owner(id) ON DELETE CASCADE,
  execution_purpose text NOT NULL DEFAULT 'paid_tournament'
    CHECK (execution_purpose = 'paid_tournament'),
  tournament_id text NOT NULL,
  bracket_id text NOT NULL,
  configuration_version text NOT NULL,
  candidate_snapshot_version text NOT NULL,
  race_id text NOT NULL,
  core_id text NOT NULL,
  idempotency_key text NOT NULL,
  decision text NOT NULL CHECK (decision = 'provisional_candidate'),
  field_evidence_sha256 text NOT NULL
    CHECK (field_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evaluation_evidence_sha256 text NOT NULL
    CHECK (evaluation_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  source_observed_at timestamptz NOT NULL CHECK (isfinite(source_observed_at)),
  evaluated_at timestamptz NOT NULL CHECK (isfinite(evaluated_at)),
  owner_consent_version text NOT NULL,
  owner_consented_at timestamptz NOT NULL CHECK (isfinite(owner_consented_at)),
  state text NOT NULL DEFAULT 'review_required'
    CHECK (state = 'review_required'),
  reconciliation_status text NOT NULL DEFAULT 'required'
    CHECK (reconciliation_status = 'required'),
  game_entry_allowed boolean NOT NULL DEFAULT false
    CHECK (NOT game_entry_allowed),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  UNIQUE (queue_id, owner_id),
  UNIQUE (owner_id, race_id),
  UNIQUE (owner_id, idempotency_key),
  FOREIGN KEY (owner_id, tournament_id, bracket_id)
    REFERENCES dna.tournament_core_selection(owner_id, tournament_id, bracket_id)
    ON DELETE CASCADE
);

ALTER TABLE dna.paid_tournament_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.paid_tournament_review_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.paid_tournament_review_queue
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE TABLE dna.paid_tournament_review_event (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'opportunity_queued'),
  tournament_id text NOT NULL,
  bracket_id text NOT NULL,
  configuration_version text NOT NULL,
  candidate_snapshot_version text NOT NULL,
  race_id text NOT NULL,
  core_id text NOT NULL,
  idempotency_key text NOT NULL,
  field_evidence_sha256 text NOT NULL
    CHECK (field_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evaluation_evidence_sha256 text NOT NULL
    CHECK (evaluation_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state = 'review_required'),
  reconciliation_status text NOT NULL CHECK (reconciliation_status = 'required'),
  game_entry_allowed boolean NOT NULL CHECK (NOT game_entry_allowed),
  occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
  UNIQUE (queue_id, event_type),
  FOREIGN KEY (queue_id, owner_id)
    REFERENCES dna.paid_tournament_review_queue(queue_id, owner_id)
    ON DELETE CASCADE
);

ALTER TABLE dna.paid_tournament_review_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.paid_tournament_review_event FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.paid_tournament_review_event
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.enqueue_paid_tournament_review(
  p_owner_id uuid,
  p_queue_id uuid,
  p_tournament_id text,
  p_bracket_id text,
  p_configuration_version text,
  p_candidate_snapshot_version text,
  p_race_id text,
  p_core_id text,
  p_idempotency_key text,
  p_decision text,
  p_field_evidence_sha256 text,
  p_evaluation_evidence_sha256 text,
  p_source_observed_at timestamptz,
  p_evaluated_at timestamptz,
  p_owner_consent_version text,
  p_owner_consented_at timestamptz,
  p_created_at timestamptz
)
RETURNS TABLE (
  queue_id uuid,
  race_id text,
  core_id text,
  state text,
  reconciliation_status text,
  game_entry_allowed boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_selection dna.tournament_core_selection%ROWTYPE;
  v_existing dna.paid_tournament_review_queue%ROWTYPE;
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
  THEN
    RAISE EXCEPTION 'owner-scoped paid Tournament review queue write denied';
  END IF;
  IF p_queue_id IS NULL
    OR p_decision IS DISTINCT FROM 'provisional_candidate'
    OR p_tournament_id IS NULL OR btrim(p_tournament_id) = ''
    OR p_bracket_id IS NULL OR btrim(p_bracket_id) = ''
    OR p_configuration_version IS NULL OR btrim(p_configuration_version) = ''
    OR p_candidate_snapshot_version IS NULL
    OR btrim(p_candidate_snapshot_version) = ''
    OR p_candidate_snapshot_version = 'snapshot-unbound'
    OR p_race_id IS NULL OR btrim(p_race_id) = ''
    OR p_core_id IS NULL OR btrim(p_core_id) = ''
    OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
    OR p_owner_consent_version IS NULL OR btrim(p_owner_consent_version) = ''
    OR octet_length(p_tournament_id) > 256
    OR octet_length(p_bracket_id) > 256
    OR octet_length(p_configuration_version) > 256
    OR octet_length(p_candidate_snapshot_version) > 256
    OR octet_length(p_race_id) > 256
    OR octet_length(p_core_id) > 128
    OR octet_length(p_idempotency_key) > 256
    OR octet_length(p_owner_consent_version) > 256
    OR concat_ws('', p_tournament_id, p_bracket_id, p_configuration_version,
      p_candidate_snapshot_version, p_race_id, p_core_id, p_idempotency_key,
      p_owner_consent_version) ~ '[[:cntrl:]]'
    OR p_field_evidence_sha256 !~ '^[0-9a-f]{64}$'
    OR p_evaluation_evidence_sha256 !~ '^[0-9a-f]{64}$'
    OR p_source_observed_at IS NULL OR NOT isfinite(p_source_observed_at)
    OR p_evaluated_at IS NULL OR NOT isfinite(p_evaluated_at)
    OR p_owner_consented_at IS NULL OR NOT isfinite(p_owner_consented_at)
    OR p_created_at IS NULL OR NOT isfinite(p_created_at)
    OR p_source_observed_at > p_evaluated_at
    OR p_evaluated_at - p_source_observed_at > interval '60 minutes'
    OR p_owner_consented_at < p_evaluated_at
    OR p_owner_consented_at > p_created_at
    OR p_created_at - p_evaluated_at > interval '15 minutes'
    OR p_created_at > clock_timestamp()
  THEN
    RAISE EXCEPTION 'paid Tournament review queue request is invalid';
  END IF;

  SELECT queued.* INTO v_existing
  FROM dna.paid_tournament_review_queue queued
  WHERE queued.owner_id = p_owner_id
    AND queued.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.queue_id IS DISTINCT FROM p_queue_id
      OR v_existing.tournament_id IS DISTINCT FROM p_tournament_id
      OR v_existing.bracket_id IS DISTINCT FROM p_bracket_id
      OR v_existing.configuration_version IS DISTINCT FROM p_configuration_version
      OR v_existing.candidate_snapshot_version IS DISTINCT FROM p_candidate_snapshot_version
      OR v_existing.race_id IS DISTINCT FROM p_race_id
      OR v_existing.core_id IS DISTINCT FROM p_core_id
      OR v_existing.decision IS DISTINCT FROM p_decision
      OR v_existing.field_evidence_sha256 IS DISTINCT FROM p_field_evidence_sha256
      OR v_existing.evaluation_evidence_sha256 IS DISTINCT FROM p_evaluation_evidence_sha256
      OR v_existing.source_observed_at IS DISTINCT FROM p_source_observed_at
      OR v_existing.evaluated_at IS DISTINCT FROM p_evaluated_at
      OR v_existing.owner_consent_version IS DISTINCT FROM p_owner_consent_version
      OR v_existing.owner_consented_at IS DISTINCT FROM p_owner_consented_at
      OR v_existing.created_at IS DISTINCT FROM p_created_at
    THEN
      RAISE EXCEPTION 'paid Tournament review idempotency conflict';
    END IF;
    RETURN QUERY SELECT v_existing.queue_id, v_existing.race_id,
      v_existing.core_id, v_existing.state, v_existing.reconciliation_status,
      v_existing.game_entry_allowed, v_existing.created_at;
    RETURN;
  END IF;

  SELECT selection.* INTO v_selection
  FROM dna.tournament_core_selection selection
  WHERE selection.owner_id = p_owner_id
    AND selection.tournament_id = p_tournament_id
    AND selection.bracket_id = p_bracket_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_selection.configuration_version IS DISTINCT FROM p_configuration_version
    OR v_selection.candidate_snapshot_version IS DISTINCT FROM
      p_candidate_snapshot_version
    OR NOT (p_core_id = ANY(v_selection.core_ids))
  THEN
    RAISE EXCEPTION 'paid Tournament review selection authority changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM dna.owner_vault_core vault
    JOIN dna.core core
      ON core.owner_id = vault.owner_id AND core.id = vault.core_id
    WHERE vault.owner_id = p_owner_id
      AND vault.in_my_vault
      AND core.source_core_id = p_core_id
  ) THEN
    RAISE EXCEPTION 'paid Tournament review Core is not currently owned';
  END IF;

  IF EXISTS (
    SELECT 1 FROM dna.paid_tournament_review_queue queued
    WHERE queued.owner_id = p_owner_id AND queued.race_id = p_race_id
  ) THEN
    RAISE EXCEPTION 'paid Tournament race is already reserved for review';
  END IF;

  INSERT INTO dna.paid_tournament_review_queue (
    queue_id, owner_id, tournament_id, bracket_id, configuration_version,
    candidate_snapshot_version, race_id, core_id, idempotency_key, decision,
    field_evidence_sha256, evaluation_evidence_sha256, source_observed_at,
    evaluated_at, owner_consent_version, owner_consented_at, created_at
  ) VALUES (
    p_queue_id, p_owner_id, p_tournament_id, p_bracket_id,
    p_configuration_version, p_candidate_snapshot_version, p_race_id,
    p_core_id, p_idempotency_key, p_decision, p_field_evidence_sha256,
    p_evaluation_evidence_sha256, p_source_observed_at, p_evaluated_at,
    p_owner_consent_version, p_owner_consented_at, p_created_at
  );

  INSERT INTO dna.paid_tournament_review_event (
    queue_id, owner_id, event_type, tournament_id, bracket_id,
    configuration_version, candidate_snapshot_version, race_id, core_id,
    idempotency_key, field_evidence_sha256, evaluation_evidence_sha256,
    state, reconciliation_status, game_entry_allowed, occurred_at
  ) VALUES (
    p_queue_id, p_owner_id, 'opportunity_queued', p_tournament_id,
    p_bracket_id, p_configuration_version, p_candidate_snapshot_version,
    p_race_id, p_core_id, p_idempotency_key, p_field_evidence_sha256,
    p_evaluation_evidence_sha256, 'review_required', 'required', false,
    p_created_at
  );

  RETURN QUERY
  SELECT queued.queue_id, queued.race_id, queued.core_id, queued.state,
    queued.reconciliation_status, queued.game_entry_allowed, queued.created_at
  FROM dna.paid_tournament_review_queue queued
  WHERE queued.owner_id = p_owner_id AND queued.queue_id = p_queue_id;
END
$function$;

CREATE FUNCTION dna.read_paid_tournament_review_queue(
  p_owner_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS SETOF dna.paid_tournament_review_queue
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100
  THEN
    RAISE EXCEPTION 'owner-scoped paid Tournament review queue read denied';
  END IF;
  RETURN QUERY
  SELECT queued.* FROM dna.paid_tournament_review_queue queued
  WHERE queued.owner_id = p_owner_id
  ORDER BY queued.created_at DESC, queued.queue_id
  LIMIT p_limit;
END
$function$;

CREATE FUNCTION dna.read_paid_tournament_review_events(
  p_owner_id uuid,
  p_queue_id uuid
)
RETURNS SETOF dna.paid_tournament_review_event
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL
    OR p_owner_id IS DISTINCT FROM dna.current_owner_id()
    OR p_queue_id IS NULL
  THEN
    RAISE EXCEPTION 'owner-scoped paid Tournament review event read denied';
  END IF;
  RETURN QUERY
  SELECT event.* FROM dna.paid_tournament_review_event event
  WHERE event.owner_id = p_owner_id AND event.queue_id = p_queue_id
  ORDER BY event.event_id;
END
$function$;

REVOKE ALL ON TABLE dna.paid_tournament_review_queue,
  dna.paid_tournament_review_event FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON SEQUENCE dna.paid_tournament_review_event_event_id_seq
  FROM PUBLIC, dna_app_runtime;
REVOKE ALL ON FUNCTION dna.enqueue_paid_tournament_review(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,text,timestamptz,timestamptz),
  dna.read_paid_tournament_review_queue(uuid,integer),
  dna.read_paid_tournament_review_events(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dna.enqueue_paid_tournament_review(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,text,timestamptz,timestamptz),
  dna.read_paid_tournament_review_queue(uuid,integer),
  dna.read_paid_tournament_review_events(uuid,uuid) TO dna_app_runtime;

COMMIT;
