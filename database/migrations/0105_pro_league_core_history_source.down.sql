BEGIN;

REVOKE ALL ON FUNCTION dna.publish_pro_league_evidence_generation_from_core_history(uuid,uuid,text,integer,integer,bigint,character,timestamptz) FROM dna_app_runtime;
REVOKE ALL ON FUNCTION dna.begin_pro_league_evidence_generation_from_core_history(uuid,uuid,character,text,character,timestamptz,bigint,bigint,bigint,bigint,bigint,bigint) FROM dna_app_runtime;
DROP FUNCTION dna.publish_pro_league_evidence_generation_from_core_history(uuid,uuid,text,integer,integer,bigint,character,timestamptz);
DROP FUNCTION dna.begin_pro_league_evidence_generation_from_core_history(uuid,uuid,character,text,character,timestamptz,bigint,bigint,bigint,bigint,bigint,bigint);

DELETE FROM dna.pro_league_evidence_active active
USING dna.pro_league_evidence_generation generation
WHERE generation.owner_id = active.owner_id
  AND generation.generation_id = active.generation_id
  AND generation.source_kind = 'core_history_generation';
INSERT INTO dna.pro_league_evidence_active (owner_id, generation_id, activated_at)
SELECT DISTINCT ON (generation.owner_id)
  generation.owner_id, generation.generation_id, generation.published_at
FROM dna.pro_league_evidence_generation generation
WHERE generation.source_kind = 'race_dataset_version'
  AND generation.state = 'published'
ORDER BY generation.owner_id, generation.evidence_cutoff_at DESC,
  generation.published_at DESC, generation.generation_id DESC
ON CONFLICT (owner_id) DO NOTHING;
DELETE FROM dna.pro_league_evidence_stage_row row
USING dna.pro_league_evidence_generation generation
WHERE generation.owner_id = row.owner_id
  AND generation.generation_id = row.generation_id
  AND generation.source_kind = 'core_history_generation';
DELETE FROM dna.pro_league_evidence_row row
USING dna.pro_league_evidence_generation generation
WHERE generation.owner_id = row.owner_id
  AND generation.generation_id = row.generation_id
  AND generation.source_kind = 'core_history_generation';
DELETE FROM dna.pro_league_evidence_generation
WHERE source_kind = 'core_history_generation';

ALTER TABLE dna.pro_league_evidence_generation
  DROP CONSTRAINT pro_league_evidence_source_identity_check,
  DROP CONSTRAINT pro_league_evidence_core_history_generation_fkey,
  DROP COLUMN core_history_generation_id,
  DROP COLUMN source_kind,
  ALTER COLUMN race_dataset_version_id SET NOT NULL;

COMMIT;
