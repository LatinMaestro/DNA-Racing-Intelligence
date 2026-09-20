DO $removal$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.validate_dna_open_lab_token_splice_payload(timestamp with time zone,jsonb,jsonb)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%chain.has_more IS DISTINCT FROM (chain.page_number < chain.maximum_page)%'
     OR v_definition LIKE '%chain.listing_count = chain.page_size_limit%' THEN
    RAISE EXCEPTION 'Arena pagination persistence reversal is incomplete';
  END IF;
END
$removal$;
