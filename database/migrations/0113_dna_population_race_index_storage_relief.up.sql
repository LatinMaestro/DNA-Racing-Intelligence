BEGIN;

-- The population index is still a staging-only reconciliation structure. No
-- runtime read function can query races by mode, and the complete inventory is
-- not published until the immutable P5 checkpoint reconciles. Keeping this
-- wide secondary index during staging duplicated the owner/generation/race
-- identity already present in the primary key and consumed material Neon
-- storage without serving a read path.
DROP INDEX IF EXISTS dna.dna_population_race_index_race_mode_idx;

COMMIT;
