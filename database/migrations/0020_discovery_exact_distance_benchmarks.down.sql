BEGIN;

DROP FUNCTION IF EXISTS dna.list_discovery_exact_distance_benchmarks(uuid, integer);
DROP FUNCTION IF EXISTS dna.refresh_discovery_exact_distance_benchmarks(timestamptz);
DROP TABLE IF EXISTS dna.discovery_exact_distance_benchmark;

COMMIT;
