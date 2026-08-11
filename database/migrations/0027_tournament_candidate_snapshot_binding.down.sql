BEGIN;

REVOKE ALL ON FUNCTION
  dna.list_bound_tournament_configurations(uuid)
FROM dna_app_runtime;
REVOKE ALL ON FUNCTION
  dna.bind_tournament_candidate_snapshot(uuid, text, text, text)
FROM dna_app_runtime;

DROP FUNCTION dna.list_bound_tournament_configurations(uuid);
DROP FUNCTION dna.bind_tournament_candidate_snapshot(uuid, text, text, text);
DROP FUNCTION dna.derive_tournament_candidate_snapshot(uuid, text);

COMMIT;
