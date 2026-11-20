DO $removal$
BEGIN
  IF to_regclass('dna.paid_tournament_review_queue') IS NOT NULL
    OR to_regclass('dna.paid_tournament_review_event') IS NOT NULL
    OR to_regprocedure(
      'dna.enqueue_paid_tournament_review(uuid,uuid,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,text,timestamptz,timestamptz)'
    ) IS NOT NULL
    OR to_regprocedure(
      'dna.read_paid_tournament_review_queue(uuid,integer)'
    ) IS NOT NULL
    OR to_regprocedure(
      'dna.read_paid_tournament_review_events(uuid,uuid)'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'paid Tournament review queue removal failed';
  END IF;
END
$removal$;
