BEGIN;

CREATE OR REPLACE FUNCTION dna.enforce_dna_open_lab_materialized_publication()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_expected bigint;
  v_actual bigint;
  v_distinct_families bigint;
BEGIN
  IF OLD.status = 'staged' AND NEW.status = 'published'
     AND NEW.materialization_contract_version >= 1 THEN
    SELECT family.item_count INTO v_expected FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'cores' AND family.status = 'complete';
    SELECT count(*) INTO v_actual FROM dna.dna_open_lab_owned_core_snapshot snapshot
    WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id;
    IF v_expected IS NULL OR v_expected <> v_actual THEN
      RAISE EXCEPTION 'DNA Open Lab owned Core materialization is incomplete';
    END IF;
  END IF;
  IF OLD.status = 'staged' AND NEW.status = 'published'
     AND NEW.materialization_contract_version >= 2 THEN
    SELECT family.item_count INTO v_expected FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'active_races' AND family.status = 'complete';
    SELECT count(*) INTO v_actual FROM dna.dna_open_lab_active_race_snapshot snapshot
    WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id;
    IF v_expected IS NULL OR v_expected <> v_actual THEN
      RAISE EXCEPTION 'DNA Open Lab active-race materialization is incomplete';
    END IF;
    SELECT family.item_count INTO v_expected FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'race_fills' AND family.status = 'complete';
    SELECT count(*) INTO v_actual FROM dna.dna_open_lab_race_fill_snapshot snapshot
    WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id;
    IF v_expected IS NULL OR v_expected <> v_actual THEN
      RAISE EXCEPTION 'DNA Open Lab race-fill materialization is incomplete';
    END IF;
  END IF;
  IF OLD.status = 'staged' AND NEW.status = 'published'
     AND NEW.materialization_contract_version >= 3 THEN
    SELECT family.item_count INTO v_expected FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'cores' AND family.status = 'complete';
    SELECT count(*), count(DISTINCT snapshot.family)
      INTO v_actual, v_distinct_families
    FROM dna.dna_open_lab_core_supplemental_snapshot snapshot
    WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id;
    IF v_expected IS NULL OR v_actual <> v_expected * 7
       OR (v_expected > 0 AND v_distinct_families <> 7)
       OR EXISTS (
         SELECT 1 FROM dna.dna_open_lab_core_supplemental_snapshot snapshot
         WHERE snapshot.owner_id = NEW.owner_id AND snapshot.generation_id = NEW.id
         GROUP BY snapshot.family HAVING count(*) <> v_expected
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab supplemental Core materialization is incomplete';
    END IF;
  END IF;
  IF OLD.status = 'staged' AND NEW.status = 'published'
     AND NEW.materialization_contract_version >= 4 THEN
    SELECT family.item_count INTO v_expected FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'tokens' AND family.status = 'complete';
    SELECT count(*) INTO v_actual FROM dna.dna_open_lab_token_prices_snapshot token
    WHERE token.owner_id = NEW.owner_id AND token.generation_id = NEW.id;
    IF v_expected IS NULL OR v_expected <> 1 OR v_actual <> 1 THEN
      RAISE EXCEPTION 'DNA Open Lab Token materialization is incomplete';
    END IF;
    SELECT family.item_count INTO v_expected FROM dna.dna_open_lab_sync_family family
    WHERE family.owner_id = NEW.owner_id AND family.generation_id = NEW.id
      AND family.family = 'splice_arena' AND family.status = 'complete';
    SELECT count(*) INTO v_actual FROM dna.dna_open_lab_splice_arena_listing_snapshot listing
    WHERE listing.owner_id = NEW.owner_id AND listing.generation_id = NEW.id;
    IF v_expected IS NULL OR v_expected <> v_actual
       OR NOT EXISTS (
         SELECT 1 FROM dna.dna_open_lab_splice_arena_mode_snapshot mode
         WHERE mode.owner_id = NEW.owner_id AND mode.generation_id = NEW.id
       ) OR EXISTS (
         SELECT 1 FROM dna.dna_open_lab_splice_arena_mode_snapshot mode
         LEFT JOIN LATERAL (
           SELECT count(*)::integer AS page_count, max(page.page) AS maximum_page
           FROM dna.dna_open_lab_splice_arena_page_snapshot page
           WHERE page.owner_id = mode.owner_id
             AND page.generation_id = mode.generation_id AND page.mode = mode.mode
         ) chain ON true
         WHERE mode.owner_id = NEW.owner_id AND mode.generation_id = NEW.id
           AND (chain.page_count = 0 OR chain.page_count <> chain.maximum_page)
       ) OR EXISTS (
         SELECT 1 FROM dna.dna_open_lab_splice_arena_page_snapshot page
         JOIN LATERAL (
           SELECT max(peer.page) AS maximum_page
           FROM dna.dna_open_lab_splice_arena_page_snapshot peer
           WHERE peer.owner_id = page.owner_id
             AND peer.generation_id = page.generation_id AND peer.mode = page.mode
         ) terminal ON true
         WHERE page.owner_id = NEW.owner_id AND page.generation_id = NEW.id
           AND (
             (page.has_more OR page.listing_count = page.page_size_limit)
               IS DISTINCT FROM (page.page < terminal.maximum_page)
             OR page.listing_count <> (
               SELECT count(*) FROM dna.dna_open_lab_splice_arena_listing_snapshot listing
               WHERE listing.owner_id = page.owner_id
                 AND listing.generation_id = page.generation_id
                 AND listing.mode = page.mode AND listing.page = page.page
             )
           )
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab Splice Arena materialization is incomplete';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

COMMIT;
