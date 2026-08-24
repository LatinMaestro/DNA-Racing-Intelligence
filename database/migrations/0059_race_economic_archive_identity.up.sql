BEGIN;

ALTER TABLE dna.economic_transaction
  ADD COLUMN race_source_event_id text,
  ADD COLUMN race_source_core_id text;

ALTER TABLE dna.race_economic_contribution
  ADD COLUMN race_source_event_id text,
  ADD COLUMN race_source_core_id text;

UPDATE dna.economic_transaction transaction
SET
  race_source_event_id = event.source_event_id,
  race_source_core_id = entry.source_core_id
FROM dna.race_entry entry
JOIN dna.race_event event
  ON event.owner_id = entry.owner_id
  AND event.id = entry.race_event_id
WHERE transaction.owner_id = entry.owner_id
  AND transaction.race_entry_id = entry.id
  AND transaction.source_type = 'race_derived';

UPDATE dna.race_economic_contribution contribution
SET
  race_source_event_id = event.source_event_id,
  race_source_core_id = entry.source_core_id
FROM dna.race_entry entry
JOIN dna.race_event event
  ON event.owner_id = entry.owner_id
  AND event.id = entry.race_event_id
WHERE contribution.owner_id = entry.owner_id
  AND contribution.race_entry_id = entry.id;

DO $race_economic_archive_identity_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dna.economic_transaction transaction
    WHERE transaction.source_type = 'race_derived'
      AND (
        transaction.race_entry_id IS NULL
        OR transaction.race_source_event_id IS NULL
        OR transaction.race_source_core_id IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'race-derived transaction archive identity could not be backfilled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dna.race_economic_contribution contribution
    WHERE contribution.race_source_event_id IS NULL
      OR contribution.race_source_core_id IS NULL
  ) THEN
    RAISE EXCEPTION 'race economic contribution archive identity could not be backfilled';
  END IF;
END
$race_economic_archive_identity_backfill$;

ALTER TABLE dna.economic_transaction
  ADD CONSTRAINT economic_transaction_race_archive_identity_check CHECK (
    source_type <> 'race_derived'
    OR (
      race_entry_id IS NOT NULL
      AND race_source_event_id IS NOT NULL
      AND NULLIF(btrim(race_source_event_id), '') IS NOT NULL
      AND race_source_core_id IS NOT NULL
      AND NULLIF(btrim(race_source_core_id), '') IS NOT NULL
    )
  );

ALTER TABLE dna.race_economic_contribution
  ALTER COLUMN race_source_event_id SET NOT NULL,
  ALTER COLUMN race_source_core_id SET NOT NULL,
  ADD CONSTRAINT race_economic_contribution_archive_identity_check CHECK (
    NULLIF(btrim(race_source_event_id), '') IS NOT NULL
    AND NULLIF(btrim(race_source_core_id), '') IS NOT NULL
  );

ALTER TABLE dna.economic_transaction
  DROP CONSTRAINT economic_transaction_owner_id_race_entry_id_fkey;

ALTER TABLE dna.race_economic_contribution
  DROP CONSTRAINT race_economic_contribution_owner_id_race_entry_id_fkey;

CREATE INDEX economic_transaction_race_archive_identity
  ON dna.economic_transaction(
    owner_id,
    race_source_core_id,
    race_source_event_id,
    occurred_at DESC
  )
  WHERE source_type = 'race_derived';

CREATE INDEX race_economic_contribution_archive_identity
  ON dna.race_economic_contribution(
    owner_id,
    race_source_event_id,
    race_source_core_id,
    transaction_type
  );

CREATE FUNCTION dna.bind_race_economic_transaction_archive_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_source_event_id text;
  v_source_core_id text;
BEGIN
  IF dna.current_owner_id() IS NULL OR NEW.owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped race economic archive identity denied';
  END IF;

  IF NEW.source_type <> 'race_derived' THEN
    IF NEW.race_source_event_id IS NOT NULL OR NEW.race_source_core_id IS NOT NULL THEN
      RAISE EXCEPTION 'non-race transaction cannot carry race archive identity';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.source_type = 'race_derived'
     AND OLD.race_source_event_id IS NOT NULL
     AND OLD.race_source_core_id IS NOT NULL THEN
    IF NEW.race_entry_id IS DISTINCT FROM OLD.race_entry_id
       OR NEW.race_source_event_id IS DISTINCT FROM OLD.race_source_event_id
       OR NEW.race_source_core_id IS DISTINCT FROM OLD.race_source_core_id THEN
      RAISE EXCEPTION 'race-derived transaction archive identity is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.race_entry_id IS NULL THEN
    RAISE EXCEPTION 'race-derived transaction requires a race entry identity';
  END IF;

  SELECT event.source_event_id, entry.source_core_id
  INTO v_source_event_id, v_source_core_id
  FROM dna.race_entry entry
  JOIN dna.race_event event
    ON event.owner_id = entry.owner_id
    AND event.id = entry.race_event_id
  WHERE entry.owner_id = NEW.owner_id
    AND entry.id = NEW.race_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'race-derived transaction race entry is unavailable';
  END IF;

  IF NEW.race_source_event_id IS NOT NULL
     AND NEW.race_source_event_id <> v_source_event_id THEN
    RAISE EXCEPTION 'race-derived transaction event identity conflicts with race entry';
  END IF;
  IF NEW.race_source_core_id IS NOT NULL
     AND NEW.race_source_core_id <> v_source_core_id THEN
    RAISE EXCEPTION 'race-derived transaction core identity conflicts with race entry';
  END IF;

  NEW.race_source_event_id := v_source_event_id;
  NEW.race_source_core_id := v_source_core_id;
  RETURN NEW;
END
$function$;

CREATE FUNCTION dna.bind_race_economic_contribution_archive_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_source_event_id text;
  v_source_core_id text;
BEGIN
  IF dna.current_owner_id() IS NULL OR NEW.owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped race economic contribution archive identity denied';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.race_source_event_id IS NOT NULL
     AND OLD.race_source_core_id IS NOT NULL THEN
    IF NEW.race_entry_id IS DISTINCT FROM OLD.race_entry_id
       OR NEW.race_source_event_id IS DISTINCT FROM OLD.race_source_event_id
       OR NEW.race_source_core_id IS DISTINCT FROM OLD.race_source_core_id THEN
      RAISE EXCEPTION 'race economic contribution archive identity is immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT event.source_event_id, entry.source_core_id
  INTO v_source_event_id, v_source_core_id
  FROM dna.race_entry entry
  JOIN dna.race_event event
    ON event.owner_id = entry.owner_id
    AND event.id = entry.race_event_id
  WHERE entry.owner_id = NEW.owner_id
    AND entry.id = NEW.race_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'race economic contribution race entry is unavailable';
  END IF;

  IF NEW.race_source_event_id IS NOT NULL
     AND NEW.race_source_event_id <> v_source_event_id THEN
    RAISE EXCEPTION 'race economic contribution event identity conflicts with race entry';
  END IF;
  IF NEW.race_source_core_id IS NOT NULL
     AND NEW.race_source_core_id <> v_source_core_id THEN
    RAISE EXCEPTION 'race economic contribution core identity conflicts with race entry';
  END IF;

  NEW.race_source_event_id := v_source_event_id;
  NEW.race_source_core_id := v_source_core_id;
  RETURN NEW;
END
$function$;

CREATE TRIGGER bind_race_economic_transaction_archive_identity
  BEFORE INSERT OR UPDATE OF
    source_type,
    race_entry_id,
    race_source_event_id,
    race_source_core_id
  ON dna.economic_transaction
  FOR EACH ROW
  EXECUTE FUNCTION dna.bind_race_economic_transaction_archive_identity();

CREATE TRIGGER bind_race_economic_contribution_archive_identity
  BEFORE INSERT OR UPDATE OF
    race_entry_id,
    race_source_event_id,
    race_source_core_id
  ON dna.race_economic_contribution
  FOR EACH ROW
  EXECUTE FUNCTION dna.bind_race_economic_contribution_archive_identity();

REVOKE ALL ON FUNCTION dna.bind_race_economic_transaction_archive_identity()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.bind_race_economic_contribution_archive_identity()
  FROM PUBLIC;

COMMIT;