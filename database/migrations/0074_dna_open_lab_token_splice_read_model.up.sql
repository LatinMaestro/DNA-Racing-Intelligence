BEGIN;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT constraint_name INTO v_constraint_name
  FROM information_schema.check_constraints
  JOIN information_schema.constraint_column_usage
    USING (constraint_catalog, constraint_schema, constraint_name)
  WHERE constraint_schema = 'dna'
    AND table_name = 'dna_open_lab_sync_generation'
    AND column_name = 'materialization_contract_version';
  IF v_constraint_name IS NULL THEN
    RAISE EXCEPTION 'materialization contract version constraint is missing';
  END IF;
  EXECUTE format(
    'ALTER TABLE dna.dna_open_lab_sync_generation DROP CONSTRAINT %I',
    v_constraint_name
  );
END;
$$;
ALTER TABLE dna.dna_open_lab_sync_generation
  ADD CONSTRAINT dna_open_lab_sync_generation_materialization_version_check
  CHECK (materialization_contract_version BETWEEN 0 AND 4);

CREATE TABLE dna.dna_open_lab_token_prices_snapshot (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  raw_evidence_sha256 character(64) NOT NULL CHECK (
    raw_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  canonical jsonb NOT NULL CHECK (jsonb_typeof(canonical) = 'object'),
  PRIMARY KEY (owner_id, generation_id),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id)
    ON DELETE CASCADE
);

CREATE TABLE dna.dna_open_lab_splice_arena_mode_snapshot (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('bike', 'car', 'horse')),
  PRIMARY KEY (owner_id, generation_id, mode),
  FOREIGN KEY (owner_id, generation_id)
    REFERENCES dna.dna_open_lab_sync_generation(owner_id, id)
    ON DELETE CASCADE
);

CREATE TABLE dna.dna_open_lab_splice_arena_page_snapshot (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  mode text NOT NULL,
  page integer NOT NULL CHECK (page BETWEEN 1 AND 1000000),
  observed_at timestamptz NOT NULL,
  raw_evidence_sha256 character(64) NOT NULL CHECK (
    raw_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  page_size_limit integer NOT NULL CHECK (
    page_size_limit BETWEEN 1 AND 1000000
  ),
  has_more boolean NOT NULL,
  listing_count integer NOT NULL CHECK (
    listing_count BETWEEN 0 AND page_size_limit
  ),
  PRIMARY KEY (owner_id, generation_id, mode, page),
  FOREIGN KEY (owner_id, generation_id, mode)
    REFERENCES dna.dna_open_lab_splice_arena_mode_snapshot(
      owner_id, generation_id, mode
    ) ON DELETE CASCADE
);

CREATE TABLE dna.dna_open_lab_splice_arena_listing_snapshot (
  owner_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  mode text NOT NULL,
  source_core_id bigint NOT NULL CHECK (
    source_core_id BETWEEN 1 AND 9007199254740991
  ),
  page integer NOT NULL,
  canonical jsonb NOT NULL CHECK (jsonb_typeof(canonical) = 'object'),
  PRIMARY KEY (owner_id, generation_id, mode, source_core_id),
  FOREIGN KEY (owner_id, generation_id, mode, page)
    REFERENCES dna.dna_open_lab_splice_arena_page_snapshot(
      owner_id, generation_id, mode, page
    ) ON DELETE CASCADE
);

ALTER TABLE dna.dna_open_lab_token_prices_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_token_prices_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_token_prices_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_splice_arena_mode_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_splice_arena_mode_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_splice_arena_mode_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_splice_arena_page_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_splice_arena_page_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_splice_arena_page_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

ALTER TABLE dna.dna_open_lab_splice_arena_listing_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE dna.dna_open_lab_splice_arena_listing_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON dna.dna_open_lab_splice_arena_listing_snapshot
  USING (owner_id = dna.current_owner_id())
  WITH CHECK (owner_id = dna.current_owner_id());

CREATE FUNCTION dna.validate_dna_open_lab_token_splice_payload(
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

CREATE FUNCTION dna.stage_dna_open_lab_token_splice_candidate(
  p_owner_id uuid,
  p_generation_id uuid,
  p_observed_at timestamptz,
  p_recorded_at timestamptz,
  p_families jsonb,
  p_owned_cores jsonb,
  p_active_races jsonb,
  p_race_fills jsonb,
  p_supplemental jsonb,
  p_token_splice jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_status text;
  v_generation dna.dna_open_lab_sync_generation%ROWTYPE;
  v_published_v4 boolean := false;
  v_generation_found boolean := false;
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab Token/Splice materialization denied';
  END IF;
  PERFORM dna.validate_dna_open_lab_token_splice_payload(
    p_observed_at, p_families, p_token_splice
  );

  SELECT generation.* INTO v_generation
  FROM dna.dna_open_lab_sync_generation generation
  WHERE generation.owner_id = p_owner_id AND generation.id = p_generation_id
  FOR UPDATE;
  v_generation_found := FOUND;
  v_published_v4 := v_generation_found
    AND v_generation.status = 'published'
    AND v_generation.materialization_contract_version = 4;
  IF v_generation_found AND v_generation.status = 'published' AND NOT v_published_v4 THEN
    RAISE EXCEPTION 'DNA Open Lab Token/Splice replay contract is invalid';
  END IF;
  IF v_published_v4 THEN
    UPDATE dna.dna_open_lab_sync_generation
    SET materialization_contract_version = 3
    WHERE owner_id = p_owner_id AND id = p_generation_id;
  END IF;

  v_status := dna.stage_dna_open_lab_supplemental_core_candidate(
    p_owner_id, p_generation_id, p_observed_at, p_recorded_at,
    p_families, p_owned_cores, p_active_races, p_race_fills, p_supplemental
  );
  IF v_published_v4 THEN
    UPDATE dna.dna_open_lab_sync_generation
    SET materialization_contract_version = 4
    WHERE owner_id = p_owner_id AND id = p_generation_id;
  END IF;

  IF v_status = 'published' THEN
    IF (SELECT count(*) FROM dna.dna_open_lab_token_prices_snapshot token
        WHERE token.owner_id = p_owner_id AND token.generation_id = p_generation_id) <> 1
       OR EXISTS (
         SELECT 1 FROM dna.dna_open_lab_token_prices_snapshot token
         WHERE token.owner_id = p_owner_id AND token.generation_id = p_generation_id
           AND (
             token.observed_at IS DISTINCT FROM
               (p_token_splice -> 'tokenPrices' ->> 'observedAt')::timestamptz
             OR token.raw_evidence_sha256 IS DISTINCT FROM
               p_token_splice -> 'tokenPrices' ->> 'rawEvidenceSha256'
             OR token.canonical IS DISTINCT FROM
               p_token_splice -> 'tokenPrices' -> 'canonical'
           )
       )
       OR (SELECT count(*) FROM dna.dna_open_lab_splice_arena_mode_snapshot mode
           WHERE mode.owner_id = p_owner_id AND mode.generation_id = p_generation_id)
          <> jsonb_array_length(p_token_splice -> 'arenaModes')
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(p_token_splice -> 'arenaModes') requested
         LEFT JOIN dna.dna_open_lab_splice_arena_mode_snapshot stored
           ON stored.owner_id = p_owner_id AND stored.generation_id = p_generation_id
          AND stored.mode = requested
         WHERE stored.mode IS NULL
       )
       OR (SELECT count(*) FROM dna.dna_open_lab_splice_arena_page_snapshot page
           WHERE page.owner_id = p_owner_id AND page.generation_id = p_generation_id)
          <> jsonb_array_length(p_token_splice -> 'arenaPages')
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_token_splice -> 'arenaPages') requested
         LEFT JOIN dna.dna_open_lab_splice_arena_page_snapshot stored
           ON stored.owner_id = p_owner_id AND stored.generation_id = p_generation_id
          AND stored.mode = requested ->> 'mode'
          AND stored.page = (requested ->> 'page')::integer
         WHERE stored.page IS NULL
            OR stored.observed_at IS DISTINCT FROM (requested ->> 'observedAt')::timestamptz
            OR stored.raw_evidence_sha256 IS DISTINCT FROM requested ->> 'rawEvidenceSha256'
            OR stored.page_size_limit IS DISTINCT FROM
              (requested -> 'canonical' ->> 'pageSizeLimit')::integer
            OR stored.has_more IS DISTINCT FROM
              (requested -> 'canonical' ->> 'hasMore')::boolean
            OR stored.listing_count IS DISTINCT FROM
              jsonb_array_length(requested -> 'canonical' -> 'listings')
       )
       OR (SELECT count(*) FROM dna.dna_open_lab_splice_arena_listing_snapshot listing
           WHERE listing.owner_id = p_owner_id
             AND listing.generation_id = p_generation_id)
          <> jsonb_array_length(p_token_splice -> 'arenaListings')
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_token_splice -> 'arenaListings') requested
         LEFT JOIN dna.dna_open_lab_splice_arena_listing_snapshot stored
           ON stored.owner_id = p_owner_id AND stored.generation_id = p_generation_id
          AND stored.mode = requested ->> 'mode'
          AND stored.source_core_id = (requested ->> 'sourceCoreId')::bigint
         WHERE stored.source_core_id IS NULL
            OR stored.page IS DISTINCT FROM (requested ->> 'page')::integer
            OR stored.canonical IS DISTINCT FROM requested -> 'canonical'
       ) THEN
      RAISE EXCEPTION 'DNA Open Lab published Token/Splice replay conflict';
    END IF;
    RETURN 'published';
  END IF;
  IF v_status <> 'staged' THEN
    RAISE EXCEPTION 'DNA Open Lab Token/Splice generation was not staged';
  END IF;

  DELETE FROM dna.dna_open_lab_token_prices_snapshot
  WHERE owner_id = p_owner_id AND generation_id = p_generation_id;
  DELETE FROM dna.dna_open_lab_splice_arena_mode_snapshot
  WHERE owner_id = p_owner_id AND generation_id = p_generation_id;

  INSERT INTO dna.dna_open_lab_token_prices_snapshot (
    owner_id, generation_id, observed_at, raw_evidence_sha256, canonical
  ) VALUES (
    p_owner_id, p_generation_id,
    (p_token_splice -> 'tokenPrices' ->> 'observedAt')::timestamptz,
    (p_token_splice -> 'tokenPrices' ->> 'rawEvidenceSha256')::character(64),
    p_token_splice -> 'tokenPrices' -> 'canonical'
  );
  INSERT INTO dna.dna_open_lab_splice_arena_mode_snapshot (
    owner_id, generation_id, mode
  ) SELECT p_owner_id, p_generation_id, value
    FROM jsonb_array_elements_text(p_token_splice -> 'arenaModes');
  INSERT INTO dna.dna_open_lab_splice_arena_page_snapshot (
    owner_id, generation_id, mode, page, observed_at,
    raw_evidence_sha256, page_size_limit, has_more, listing_count
  ) SELECT p_owner_id, p_generation_id, entry ->> 'mode',
    (entry ->> 'page')::integer, (entry ->> 'observedAt')::timestamptz,
    (entry ->> 'rawEvidenceSha256')::character(64),
    (entry -> 'canonical' ->> 'pageSizeLimit')::integer,
    (entry -> 'canonical' ->> 'hasMore')::boolean,
    jsonb_array_length(entry -> 'canonical' -> 'listings')
  FROM jsonb_array_elements(p_token_splice -> 'arenaPages') entry;
  INSERT INTO dna.dna_open_lab_splice_arena_listing_snapshot (
    owner_id, generation_id, mode, source_core_id, page, canonical
  ) SELECT p_owner_id, p_generation_id, entry ->> 'mode',
    (entry ->> 'sourceCoreId')::bigint, (entry ->> 'page')::integer,
    entry -> 'canonical'
  FROM jsonb_array_elements(p_token_splice -> 'arenaListings') entry;
  UPDATE dna.dna_open_lab_sync_generation
  SET materialization_contract_version = 4
  WHERE owner_id = p_owner_id AND id = p_generation_id;
  RETURN 'staged';
END
$function$;

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
             page.has_more IS DISTINCT FROM (page.page < terminal.maximum_page)
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

CREATE FUNCTION dna.read_dna_open_lab_serving_token_prices(p_owner_id uuid)
RETURNS TABLE (
  generation_id uuid, observed_at timestamptz,
  raw_evidence_sha256 character(64), canonical jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab Token read denied';
  END IF;
  RETURN QUERY SELECT token.generation_id, token.observed_at,
    token.raw_evidence_sha256, token.canonical
  FROM dna.dna_open_lab_sync_state state
  JOIN dna.dna_open_lab_token_prices_snapshot token
    ON token.owner_id = state.owner_id
   AND token.generation_id = state.serving_generation_id
  WHERE state.owner_id = p_owner_id;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_serving_splice_arena_pages(p_owner_id uuid)
RETURNS TABLE (
  generation_id uuid, mode text, page integer, observed_at timestamptz,
  raw_evidence_sha256 character(64), page_size_limit integer,
  has_more boolean, listing_count integer
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab Arena-page read denied';
  END IF;
  RETURN QUERY SELECT page.generation_id, page.mode, page.page,
    page.observed_at, page.raw_evidence_sha256, page.page_size_limit,
    page.has_more, page.listing_count
  FROM dna.dna_open_lab_sync_state state
  JOIN dna.dna_open_lab_splice_arena_page_snapshot page
    ON page.owner_id = state.owner_id
   AND page.generation_id = state.serving_generation_id
  WHERE state.owner_id = p_owner_id
  ORDER BY CASE page.mode WHEN 'bike' THEN 0 WHEN 'car' THEN 1 ELSE 2 END,
    page.page;
END
$function$;

CREATE FUNCTION dna.read_dna_open_lab_serving_splice_arena(p_owner_id uuid)
RETURNS TABLE (
  generation_id uuid, mode text, source_core_id bigint,
  page integer, observed_at timestamptz,
  raw_evidence_sha256 character(64), canonical jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF dna.current_owner_id() IS NULL OR p_owner_id <> dna.current_owner_id() THEN
    RAISE EXCEPTION 'owner-scoped DNA Open Lab Arena read denied';
  END IF;
  RETURN QUERY SELECT listing.generation_id, listing.mode,
    listing.source_core_id, listing.page, page.observed_at,
    page.raw_evidence_sha256, listing.canonical
  FROM dna.dna_open_lab_sync_state state
  JOIN dna.dna_open_lab_splice_arena_listing_snapshot listing
    ON listing.owner_id = state.owner_id
   AND listing.generation_id = state.serving_generation_id
  JOIN dna.dna_open_lab_splice_arena_page_snapshot page
    ON page.owner_id = listing.owner_id AND page.generation_id = listing.generation_id
   AND page.mode = listing.mode AND page.page = listing.page
  WHERE state.owner_id = p_owner_id
  ORDER BY CASE listing.mode WHEN 'bike' THEN 0 WHEN 'car' THEN 1 ELSE 2 END,
    listing.source_core_id;
END
$function$;

REVOKE ALL ON TABLE dna.dna_open_lab_token_prices_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_splice_arena_mode_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_splice_arena_page_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE dna.dna_open_lab_splice_arena_listing_snapshot FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.validate_dna_open_lab_token_splice_payload(
  timestamptz, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.stage_dna_open_lab_token_splice_candidate(
  uuid, uuid, timestamptz, timestamptz,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_serving_token_prices(uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_serving_splice_arena_pages(uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION dna.read_dna_open_lab_serving_splice_arena(uuid)
FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION dna.stage_dna_open_lab_supplemental_core_candidate(
  uuid, uuid, timestamptz, timestamptz,
  jsonb, jsonb, jsonb, jsonb, jsonb
) FROM dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.stage_dna_open_lab_token_splice_candidate(
  uuid, uuid, timestamptz, timestamptz,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_serving_token_prices(uuid)
TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_serving_splice_arena_pages(uuid)
TO dna_app_runtime;
GRANT EXECUTE ON FUNCTION dna.read_dna_open_lab_serving_splice_arena(uuid)
TO dna_app_runtime;

COMMIT;
