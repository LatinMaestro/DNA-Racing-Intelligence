BEGIN;

CREATE OR REPLACE FUNCTION dna.validate_dna_open_lab_token_splice_payload(
  p_observed_at timestamptz,
  p_families jsonb,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_token jsonb;
  v_token_canonical jsonb;
  v_modes jsonb;
  v_pages jsonb;
  v_listings jsonb;
  v_row jsonb;
  v_canonical jsonb;
  v_key_count integer;
  v_mode text;
  v_page integer;
  v_source_core_id numeric;
  v_row_observed_at timestamptz;
  v_page_limit integer;
  v_page_listing_count integer;
BEGIN
  IF jsonb_typeof(p_payload) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_payload)) <> 4
     OR NOT (p_payload ?& ARRAY[
       'tokenPrices', 'arenaModes', 'arenaPages', 'arenaListings'
     ]) THEN
    RAISE EXCEPTION 'DNA Open Lab Token/Splice payload shape is invalid';
  END IF;
  v_token := p_payload -> 'tokenPrices';
  v_modes := p_payload -> 'arenaModes';
  v_pages := p_payload -> 'arenaPages';
  v_listings := p_payload -> 'arenaListings';

  IF jsonb_typeof(v_token) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_token)) <> 3
     OR NOT (v_token ?& ARRAY[
       'observedAt', 'rawEvidenceSha256', 'canonical'
     ])
     OR jsonb_typeof(v_token -> 'observedAt') <> 'string'
     OR jsonb_typeof(v_token -> 'rawEvidenceSha256') <> 'string'
     OR v_token ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(v_token -> 'canonical') <> 'object' THEN
    RAISE EXCEPTION 'DNA Open Lab Token row is invalid';
  END IF;
  BEGIN
    v_row_observed_at := (v_token ->> 'observedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'DNA Open Lab Token observation time is invalid';
  END;
  IF v_row_observed_at > p_observed_at THEN
    RAISE EXCEPTION 'DNA Open Lab Token chronology is invalid';
  END IF;
  v_token_canonical := v_token -> 'canonical';
  IF (SELECT count(*) FROM jsonb_object_keys(v_token_canonical)) <> 3
     OR NOT (v_token_canonical ?& ARRAY[
       'sourceType', 'valuationUse', 'usdReferencePriceByAsset'
     ])
     OR v_token_canonical ->> 'sourceType' <> 'token_prices_snapshot'
     OR v_token_canonical ->> 'valuationUse' <> 'current_reference_only'
     OR jsonb_typeof(v_token_canonical -> 'usdReferencePriceByAsset') <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(
       v_token_canonical -> 'usdReferencePriceByAsset'
     )) <> 8
     OR NOT ((v_token_canonical -> 'usdReferencePriceByAsset') ?& ARRAY[
       'ETH', 'BTC', 'DEZ', 'HLX', 'BGC', 'TP', 'METH', 'MBTC'
     ])
     OR EXISTS (
       SELECT 1 FROM jsonb_each(v_token_canonical -> 'usdReferencePriceByAsset') price
       WHERE jsonb_typeof(price.value) <> 'number'
          OR (price.value #>> '{}')::numeric < 0
     ) THEN
    RAISE EXCEPTION 'DNA Open Lab Token canonical payload is invalid';
  END IF;

  IF jsonb_typeof(v_modes) <> 'array'
     OR jsonb_array_length(v_modes) NOT BETWEEN 1 AND 3
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_modes) AS mode(value)
       WHERE jsonb_typeof(mode.value) <> 'string'
          OR mode.value #>> '{}' NOT IN ('bike', 'car', 'horse')
     )
     OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(v_modes))
        <> jsonb_array_length(v_modes) THEN
    RAISE EXCEPTION 'DNA Open Lab Arena mode receipt is invalid';
  END IF;
  IF jsonb_typeof(v_pages) <> 'array'
     OR jsonb_array_length(v_pages) NOT BETWEEN 1 AND 10000
     OR jsonb_typeof(v_listings) <> 'array'
     OR jsonb_array_length(v_listings) > 100000 THEN
    RAISE EXCEPTION 'DNA Open Lab Arena collection bounds are invalid';
  END IF;
  IF jsonb_typeof(p_families) <> 'object'
     OR p_families -> 'tokens' ->> 'status' <> 'complete'
     OR p_families -> 'tokens' ->> 'itemCount' <> '1'
     OR p_families -> 'splice_arena' ->> 'status' <> 'complete'
     OR p_families -> 'splice_arena' ->> 'itemCount' !~ '^[0-9]+$'
     OR (p_families -> 'splice_arena' ->> 'itemCount')::bigint
        <> jsonb_array_length(v_listings) THEN
    RAISE EXCEPTION 'DNA Open Lab Token/Splice family receipts are invalid';
  END IF;

  IF (SELECT count(DISTINCT concat_ws(':', value ->> 'mode', value ->> 'page'))
      FROM jsonb_array_elements(v_pages)) <> jsonb_array_length(v_pages) THEN
    RAISE EXCEPTION 'DNA Open Lab Arena pages contain duplicate identities';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_pages)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'DNA Open Lab Arena page row is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_row);
    v_canonical := v_row -> 'canonical';
    IF v_key_count <> 5
       OR NOT (v_row ?& ARRAY[
         'mode', 'page', 'observedAt', 'rawEvidenceSha256', 'canonical'
       ])
       OR v_row ->> 'mode' NOT IN ('bike', 'car', 'horse')
       OR NOT (v_modes @> jsonb_build_array(v_row -> 'mode'))
       OR v_row ->> 'page' !~ '^[1-9][0-9]*$'
       OR jsonb_typeof(v_row -> 'observedAt') <> 'string'
       OR v_row ->> 'rawEvidenceSha256' !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(v_canonical) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_canonical)) <> 6
       OR NOT (v_canonical ?& ARRAY[
         'sourceType', 'mode', 'page', 'pageSizeLimit', 'hasMore', 'listings'
       ])
       OR v_canonical ->> 'sourceType' <> 'splice_arena_page_snapshot'
       OR v_canonical ->> 'mode' IS DISTINCT FROM v_row ->> 'mode'
       OR v_canonical ->> 'page' IS DISTINCT FROM v_row ->> 'page'
       OR v_canonical ->> 'pageSizeLimit' !~ '^[1-9][0-9]*$'
       OR jsonb_typeof(v_canonical -> 'hasMore') <> 'boolean'
       OR jsonb_typeof(v_canonical -> 'listings') <> 'array' THEN
      RAISE EXCEPTION 'DNA Open Lab Arena page fields are invalid';
    END IF;
    v_page := (v_row ->> 'page')::integer;
    v_page_limit := (v_canonical ->> 'pageSizeLimit')::integer;
    v_page_listing_count := jsonb_array_length(v_canonical -> 'listings');
    BEGIN
      v_row_observed_at := (v_row ->> 'observedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'DNA Open Lab Arena page observation time is invalid';
    END;
    IF v_page NOT BETWEEN 1 AND 1000000
       OR v_page_limit NOT BETWEEN 1 AND 1000000
       OR v_page_listing_count > v_page_limit
       OR v_row_observed_at > p_observed_at THEN
      RAISE EXCEPTION 'DNA Open Lab Arena page is out of bounds';
    END IF;
  END LOOP;

  FOR v_mode IN SELECT value FROM jsonb_array_elements_text(v_modes)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_pages) page
      WHERE page ->> 'mode' = v_mode
    ) OR EXISTS (
      SELECT 1
      FROM (
        SELECT (page ->> 'page')::integer AS page_number,
          (page -> 'canonical' ->> 'hasMore')::boolean AS has_more,
          max((page ->> 'page')::integer) OVER () AS maximum_page,
          count(*) OVER () AS page_count
        FROM jsonb_array_elements(v_pages) page
        WHERE page ->> 'mode' = v_mode
      ) chain
      WHERE chain.page_count <> chain.maximum_page
         OR chain.has_more IS DISTINCT FROM (chain.page_number < chain.maximum_page)
    ) THEN
      RAISE EXCEPTION 'DNA Open Lab Arena % pagination is incomplete', v_mode;
    END IF;
  END LOOP;

  IF (SELECT count(DISTINCT concat_ws(':', value ->> 'mode', value ->> 'sourceCoreId'))
      FROM jsonb_array_elements(v_listings)) <> jsonb_array_length(v_listings) THEN
    RAISE EXCEPTION 'DNA Open Lab Arena listings contain duplicate mode/Core identities';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_listings)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'DNA Open Lab Arena listing row is invalid';
    END IF;
    SELECT count(*)::integer INTO v_key_count FROM jsonb_object_keys(v_row);
    v_canonical := v_row -> 'canonical';
    IF v_key_count <> 6
       OR NOT (v_row ?& ARRAY[
         'mode', 'sourceCoreId', 'page', 'pageObservedAt',
         'pageRawEvidenceSha256', 'canonical'
       ])
       OR v_row ->> 'mode' NOT IN ('bike', 'car', 'horse')
       OR v_row ->> 'sourceCoreId' !~ '^[1-9][0-9]*$'
       OR length(v_row ->> 'sourceCoreId') > 16
       OR v_row ->> 'page' !~ '^[1-9][0-9]*$'
       OR jsonb_typeof(v_row -> 'pageObservedAt') <> 'string'
       OR v_row ->> 'pageRawEvidenceSha256' !~ '^[a-f0-9]{64}$'
       OR jsonb_typeof(v_canonical) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_canonical)) <> 9
       OR NOT (v_canonical ?& ARRAY[
         'sourceCoreId', 'displayName', 'coreTypeSourceValue',
         'genderSourceValue', 'elementSourceValue', 'colorSourceValue',
         'hexColorSourceValue', 'fNumber', 'priceUsdSourceValue'
       ])
       OR v_canonical ->> 'sourceCoreId' IS DISTINCT FROM v_row ->> 'sourceCoreId'
       OR jsonb_typeof(v_canonical -> 'displayName') <> 'string'
       OR jsonb_typeof(v_canonical -> 'coreTypeSourceValue') <> 'string'
       OR jsonb_typeof(v_canonical -> 'genderSourceValue') <> 'string'
       OR jsonb_typeof(v_canonical -> 'elementSourceValue') <> 'string'
       OR jsonb_typeof(v_canonical -> 'colorSourceValue') <> 'string'
       OR jsonb_typeof(v_canonical -> 'hexColorSourceValue') <> 'string'
       OR v_canonical ->> 'fNumber' !~ '^[1-9][0-9]*$'
       OR jsonb_typeof(v_canonical -> 'priceUsdSourceValue') <> 'number'
       OR (v_canonical ->> 'priceUsdSourceValue')::numeric < 0 THEN
      RAISE EXCEPTION 'DNA Open Lab Arena listing fields are invalid';
    END IF;
    v_page := (v_row ->> 'page')::integer;
    v_source_core_id := (v_row ->> 'sourceCoreId')::numeric;
    BEGIN
      v_row_observed_at := (v_row ->> 'pageObservedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'DNA Open Lab Arena listing observation time is invalid';
    END;
    IF v_source_core_id NOT BETWEEN 1 AND 9007199254740991
       OR v_page NOT BETWEEN 1 AND 1000000
       OR (v_canonical ->> 'fNumber')::integer NOT BETWEEN 1 AND 1000000
       OR v_row_observed_at > p_observed_at
       OR EXISTS (
         SELECT 1 FROM jsonb_each_text(v_canonical) field
         WHERE field.key IN (
           'displayName', 'coreTypeSourceValue', 'genderSourceValue',
           'elementSourceValue', 'colorSourceValue', 'hexColorSourceValue'
         ) AND (
           length(field.value) NOT BETWEEN 1 AND 256
           OR field.value ~ '[[:cntrl:]]'
         )
       ) OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_pages) page
         WHERE page ->> 'mode' = v_row ->> 'mode'
           AND page ->> 'page' = v_row ->> 'page'
           AND (page ->> 'observedAt')::timestamptz = v_row_observed_at
           AND page ->> 'rawEvidenceSha256' = v_row ->> 'pageRawEvidenceSha256'
           AND page -> 'canonical' -> 'listings' @> jsonb_build_array(v_canonical)
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab Arena listing authority is invalid';
    END IF;
  END LOOP;

  IF (SELECT coalesce(sum(jsonb_array_length(page -> 'canonical' -> 'listings')), 0)
      FROM jsonb_array_elements(v_pages) page) <> jsonb_array_length(v_listings)
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_pages) page
       CROSS JOIN LATERAL jsonb_array_elements(page -> 'canonical' -> 'listings') listing
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_listings) row
         WHERE row ->> 'mode' = page ->> 'mode'
           AND row ->> 'page' = page ->> 'page'
           AND row -> 'canonical' = listing
       )
     ) THEN
    RAISE EXCEPTION 'DNA Open Lab Arena page/listing coverage is invalid';
  END IF;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range
    OR datetime_field_overflow THEN
    RAISE EXCEPTION 'DNA Open Lab Token/Splice canonical value is invalid';
END
$function$;


COMMIT;
