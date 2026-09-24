BEGIN;

REVOKE ALL ON FUNCTION
  dna.read_dna_population_race_index_published_r2_chunk_manifests(uuid,text,integer,integer)
FROM PUBLIC, dna_app_runtime;

DROP FUNCTION IF EXISTS
  dna.read_dna_population_race_index_published_r2_chunk_manifests(uuid,text,integer,integer);

COMMIT;
