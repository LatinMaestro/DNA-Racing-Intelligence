DO $arena_publication_pagination_truth_removal$
DECLARE
  v_definition text;
  v_trigger_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'dna.enforce_dna_open_lab_materialized_publication()'::regprocedure
  ) INTO v_definition;

  IF position(
    'page.has_more IS DISTINCT FROM (page.page < terminal.maximum_page)' in v_definition
  ) = 0
     OR position(
       '(page.has_more OR page.listing_count = page.page_size_limit)' in v_definition
     ) > 0 THEN
    RAISE EXCEPTION 'Arena publication pagination migration did not reverse cleanly';
  END IF;

  SELECT count(*)::integer INTO v_trigger_count
  FROM pg_trigger trigger_record
  WHERE trigger_record.tgrelid = 'dna.dna_open_lab_sync_generation'::regclass
    AND trigger_record.tgname = 'enforce_dna_open_lab_materialized_publication'
    AND NOT trigger_record.tgisinternal;

  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'Arena publication guard trigger binding changed during reversal';
  END IF;
END
$arena_publication_pagination_truth_removal$;
