BEGIN;
DROP FUNCTION dna.read_tournament_core_selection(uuid,text,text);
DROP FUNCTION dna.replace_tournament_core_selection(
  uuid,text,text,text,text,text[],timestamptz);
DROP TABLE dna.tournament_core_selection;
COMMIT;
