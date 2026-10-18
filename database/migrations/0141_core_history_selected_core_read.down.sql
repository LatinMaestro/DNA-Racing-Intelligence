BEGIN;
DROP FUNCTION dna.read_selected_dna_core_race_history_rows(uuid,character,character,text[],integer);
DROP INDEX dna.dna_core_history_selected_core_read_idx;
COMMIT;
