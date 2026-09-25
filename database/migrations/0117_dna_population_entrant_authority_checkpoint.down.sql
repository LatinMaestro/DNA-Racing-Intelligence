BEGIN;

REVOKE ALL ON FUNCTION
  dna.read_dna_population_entrant_authority_chunk_manifests(uuid,text,integer,integer),
  dna.read_dna_population_entrant_authority_generation(uuid,text),
  dna.register_dna_population_entrant_authority_chunk(uuid,text,jsonb,timestamp with time zone),
  dna.begin_dna_population_entrant_authority_generation(uuid,jsonb,timestamp with time zone)
FROM PUBLIC, dna_app_runtime;

DROP FUNCTION IF EXISTS
  dna.read_dna_population_entrant_authority_chunk_manifests(uuid,text,integer,integer);
DROP FUNCTION IF EXISTS
  dna.read_dna_population_entrant_authority_generation(uuid,text);
DROP FUNCTION IF EXISTS
  dna.register_dna_population_entrant_authority_chunk(uuid,text,jsonb,timestamp with time zone);
DROP FUNCTION IF EXISTS
  dna.begin_dna_population_entrant_authority_generation(uuid,jsonb,timestamp with time zone);

DROP TABLE IF EXISTS dna.dna_population_entrant_authority_chunk;
DROP TABLE IF EXISTS dna.dna_population_entrant_authority_generation;

COMMIT;
