DO $removal$
BEGIN
  IF to_regclass('dna.manual_tournament_payout_state') IS NOT NULL
    OR to_regclass('dna.manual_tournament_payout_candidate_set') IS NOT NULL
    OR to_regprocedure('dna.read_manual_tournament_payout_write_context(uuid)') IS NOT NULL
    OR to_regprocedure('dna.publish_manual_tournament_payout_candidate_set(uuid,text,timestamptz,text,text,integer,character,character,text,text,text)') IS NOT NULL
    OR to_regprocedure('dna.read_manual_tournament_payout_candidates(uuid,text,timestamptz,text,text,integer)') IS NOT NULL
    OR to_regprocedure('dna.write_manual_tournament_payout(uuid,text,character,text,text,text,text,text)') IS NOT NULL
    OR to_regprocedure('dna.read_manual_tournament_payout(uuid,text)') IS NOT NULL
    OR to_regprocedure('dna.write_manual_tournament_payout_reconciliation(uuid,text,bigint,character,text,text,text,boolean)') IS NOT NULL
  THEN RAISE EXCEPTION 'manual tournament payout persistence remains'; END IF;
END
$removal$;
