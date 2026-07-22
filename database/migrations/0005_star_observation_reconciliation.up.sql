BEGIN;

CREATE INDEX manual_star_observation_reconcile_queue
  ON dna.manual_star_observation(owner_id, reconciliation_status, key_authority, event_starts_at);
CREATE INDEX race_event_reconcile_candidate
  ON dna.race_event(owner_id, event_at, mode, distance, gate_count)
  WHERE active_in_dataset;

CREATE FUNCTION dna.reconcile_manual_star_observations(
  p_reconciled_at timestamptz
)
RETURNS TABLE (
  exact_match_count bigint,
  mismatch_count bigint,
  review_required_count bigint,
  excluded_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_owner_id uuid := dna.current_owner_id();
  observation dna.manual_star_observation%ROWTYPE;
  matched_event dna.race_event%ROWTYPE;
  validation dna.event_star_validation%ROWTYPE;
  v_candidate_ids uuid[];
  v_candidate_count integer;
  v_observed_field text[];
  v_imported_field text[];
  v_result text;
  v_detail_code text;
  v_preserved_warnings text[];
  v_exact bigint := 0;
  v_mismatch bigint := 0;
  v_review bigint := 0;
  v_excluded bigint := 0;
  v_auto_codes constant text[] := ARRAY[
    'AUTHORITATIVE_EVENT_NOT_IMPORTED',
    'NO_CANDIDATE_MATCH',
    'AMBIGUOUS_CANDIDATE_MATCH',
    'CANDIDATE_MATCH_REQUIRES_REVIEW',
    'AUTHORITATIVE_VALIDATION_PENDING',
    'AUTHORITATIVE_STAR_DATA_INCOMPLETE',
    'AUTHORITATIVE_STAR_ASSIGNMENT_AMBIGUOUS',
    'EVENT_METADATA_MISMATCH',
    'FIELD_MISMATCH',
    'OBSERVED_STAR_NOT_IN_FIELD',
    'GOLD_INELIGIBLE_OBSERVATION',
    'STAR_ASSIGNMENT_MISMATCH'
  ];
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'app.owner_id must be set for star-observation reconciliation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':star-observation-reconciliation', 0)
  );

  FOR observation IN
    SELECT observed.*
    FROM dna.manual_star_observation observed
    WHERE
      observed.owner_id = v_owner_id
      AND observed.reconciliation_status IN ('pending', 'review_required')
      AND NOT EXISTS (
        SELECT 1
        FROM dna.star_observation_reconciliation prior
        WHERE
          prior.owner_id = observed.owner_id
          AND prior.observation_id = observed.id
          AND prior.reviewed_at IS NOT NULL
      )
    ORDER BY observed.event_starts_at, observed.id
    FOR UPDATE
  LOOP
    SELECT COALESCE(array_agg(entry.source_core_id ORDER BY entry.source_core_id), '{}'::text[])
    INTO v_observed_field
    FROM dna.manual_star_observation_entry entry
    WHERE entry.owner_id = v_owner_id AND entry.observation_id = observation.id;

    SELECT COALESCE(array_agg(code ORDER BY code), '{}'::text[])
    INTO v_preserved_warnings
    FROM unnest(observation.warning_codes) code
    WHERE NOT (code = ANY(v_auto_codes));

    DELETE FROM dna.star_observation_reconciliation prior
    WHERE
      prior.owner_id = v_owner_id
      AND prior.observation_id = observation.id
      AND prior.reviewed_at IS NULL;

    v_result := NULL;
    v_detail_code := NULL;
    matched_event := NULL;
    validation := NULL;

    IF cardinality(v_observed_field) = 0 THEN
      v_result := 'excluded';
      v_detail_code := 'OBSERVED_STAR_NOT_IN_FIELD';
    ELSIF observation.key_authority = 'authoritative_event_id' THEN
      SELECT event.*
      INTO matched_event
      FROM dna.race_event event
      WHERE
        event.owner_id = v_owner_id
        AND event.source_event_id = observation.authoritative_source_event_id
        AND event.active_in_dataset;

      IF NOT FOUND THEN
        v_result := 'review_required';
        v_detail_code := 'AUTHORITATIVE_EVENT_NOT_IMPORTED';
      END IF;
    ELSE
      SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.id), '{}'::uuid[])
      INTO v_candidate_ids
      FROM dna.race_event candidate
      WHERE
        candidate.owner_id = v_owner_id
        AND candidate.active_in_dataset
        AND candidate.event_at = observation.event_starts_at
        AND candidate.mode = observation.mode
        AND candidate.distance = observation.distance
        AND candidate.gate_count = observation.gate_count
        AND ARRAY(
          SELECT entry.source_core_id
          FROM dna.race_entry entry
          WHERE
            entry.owner_id = candidate.owner_id
            AND entry.race_event_id = candidate.id
            AND entry.active_in_dataset
          ORDER BY entry.source_core_id
        ) = v_observed_field;

      v_candidate_count := cardinality(v_candidate_ids);

      IF v_candidate_count = 1 THEN
        SELECT event.* INTO matched_event
        FROM dna.race_event event
        WHERE event.owner_id = v_owner_id AND event.id = v_candidate_ids[1];
        v_result := 'review_required';
        v_detail_code := 'CANDIDATE_MATCH_REQUIRES_REVIEW';
      ELSIF v_candidate_count = 0 THEN
        v_result := 'review_required';
        v_detail_code := 'NO_CANDIDATE_MATCH';
      ELSE
        v_result := 'review_required';
        v_detail_code := 'AMBIGUOUS_CANDIDATE_MATCH';
      END IF;
    END IF;

    IF matched_event.id IS NOT NULL AND observation.key_authority = 'authoritative_event_id' THEN
      SELECT COALESCE(array_agg(entry.source_core_id ORDER BY entry.source_core_id), '{}'::text[])
      INTO v_imported_field
      FROM dna.race_entry entry
      WHERE
        entry.owner_id = v_owner_id
        AND entry.race_event_id = matched_event.id
        AND entry.active_in_dataset;

      SELECT event_validation.*
      INTO validation
      FROM dna.event_star_validation event_validation
      WHERE
        event_validation.owner_id = v_owner_id
        AND event_validation.race_event_id = matched_event.id;

      IF observation.event_starts_at <> matched_event.event_at
        OR observation.mode <> matched_event.mode
        OR observation.distance <> matched_event.distance
        OR observation.gate_count <> matched_event.gate_count THEN
        v_result := 'mismatch';
        v_detail_code := 'EVENT_METADATA_MISMATCH';
      ELSIF v_observed_field <> v_imported_field THEN
        v_result := 'mismatch';
        v_detail_code := 'FIELD_MISMATCH';
      ELSIF (
        observation.observed_gold_source_core_id IS NOT NULL
        AND NOT (observation.observed_gold_source_core_id = ANY(v_observed_field))
      ) OR (
        observation.observed_blue_source_core_id IS NOT NULL
        AND NOT (observation.observed_blue_source_core_id = ANY(v_observed_field))
      ) THEN
        v_result := 'excluded';
        v_detail_code := 'OBSERVED_STAR_NOT_IN_FIELD';
      ELSIF NOT matched_event.gold_star_eligible
        AND observation.observed_gold_source_core_id IS NOT NULL THEN
        v_result := 'mismatch';
        v_detail_code := 'GOLD_INELIGIBLE_OBSERVATION';
      ELSIF validation.race_event_id IS NULL THEN
        v_result := 'review_required';
        v_detail_code := 'AUTHORITATIVE_VALIDATION_PENDING';
      ELSIF NOT validation.gold_data_complete OR NOT validation.blue_data_complete THEN
        v_result := 'review_required';
        v_detail_code := 'AUTHORITATIVE_STAR_DATA_INCOMPLETE';
      ELSIF validation.gold_assignment_count > 1 OR validation.blue_assignment_count > 1 THEN
        v_result := 'review_required';
        v_detail_code := 'AUTHORITATIVE_STAR_ASSIGNMENT_AMBIGUOUS';
      ELSIF observation.observed_gold_source_core_id IS NOT DISTINCT FROM validation.gold_source_core_id
        AND observation.observed_blue_source_core_id IS NOT DISTINCT FROM validation.blue_source_core_id THEN
        v_result := 'exact_match';
        v_detail_code := NULL;
      ELSE
        v_result := 'mismatch';
        v_detail_code := 'STAR_ASSIGNMENT_MISMATCH';
      END IF;
    END IF;

    IF matched_event.id IS NOT NULL THEN
      INSERT INTO dna.star_observation_reconciliation (
        id,
        owner_id,
        observation_id,
        race_event_id,
        result,
        detail_code,
        reviewed_at,
        created_at
      )
      VALUES (
        md5(v_owner_id::text || ':star_reconciliation:' || observation.id::text || ':' || matched_event.id::text)::uuid,
        v_owner_id,
        observation.id,
        matched_event.id,
        v_result,
        v_detail_code,
        NULL,
        p_reconciled_at
      )
      ON CONFLICT (owner_id, observation_id, race_event_id) DO UPDATE
      SET
        result = EXCLUDED.result,
        detail_code = EXCLUDED.detail_code;
    END IF;

    UPDATE dna.manual_star_observation
    SET
      reconciliation_status = CASE v_result
        WHEN 'exact_match' THEN 'reconciled'
        WHEN 'mismatch' THEN 'mismatch'
        WHEN 'excluded' THEN 'excluded'
        ELSE 'review_required'
      END,
      reconciled_race_event_id = CASE
        WHEN matched_event.id IS NOT NULL THEN matched_event.id
        ELSE NULL
      END,
      warning_codes = CASE
        WHEN v_detail_code IS NULL THEN v_preserved_warnings
        ELSE v_preserved_warnings || ARRAY[v_detail_code]
      END,
      updated_at = p_reconciled_at
    WHERE owner_id = v_owner_id AND id = observation.id;

    CASE v_result
      WHEN 'exact_match' THEN v_exact := v_exact + 1;
      WHEN 'mismatch' THEN v_mismatch := v_mismatch + 1;
      WHEN 'excluded' THEN v_excluded := v_excluded + 1;
      ELSE v_review := v_review + 1;
    END CASE;
  END LOOP;

  RETURN QUERY SELECT v_exact, v_mismatch, v_review, v_excluded;
END
$function$;

REVOKE ALL ON FUNCTION dna.reconcile_manual_star_observations(timestamptz) FROM PUBLIC;

COMMIT;
