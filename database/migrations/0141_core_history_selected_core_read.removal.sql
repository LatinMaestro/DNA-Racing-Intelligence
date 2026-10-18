DO $removal$
BEGIN
  IF to_regprocedure('dna.read_selected_dna_core_race_history_rows(uuid,character,character,text[],integer)') IS NOT NULL
     OR to_regclass('dna.dna_core_history_selected_core_read_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'selected Core history read removal is incomplete';
  END IF;
END
$removal$;
