BEGIN;

REVOKE ALL ON FUNCTION
  dna.read_dna_population_race_index_published_compact_identities(uuid,text,text,integer)
FROM PUBLIC, dna_app_runtime;

DROP FUNCTION IF EXISTS
  dna.read_dna_population_race_index_published_compact_identities(uuid,text,text,integer);

COMMIT;
