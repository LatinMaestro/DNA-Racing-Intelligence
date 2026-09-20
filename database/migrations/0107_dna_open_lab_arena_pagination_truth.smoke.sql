BEGIN;

DO $smoke$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.validate_dna_open_lab_token_splice_payload(timestamp with time zone,jsonb,jsonb)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%jsonb_array_length(page -> ''canonical'' -> ''listings'')%'
     OR v_definition NOT LIKE '%chain.listing_count = chain.page_size_limit%'
     OR v_definition LIKE '%chain.has_more IS DISTINCT FROM (chain.page_number < chain.maximum_page)%' THEN
    RAISE EXCEPTION 'Arena false-negative has_more persistence fix is not installed';
  END IF;
END
$smoke$;

ROLLBACK;
