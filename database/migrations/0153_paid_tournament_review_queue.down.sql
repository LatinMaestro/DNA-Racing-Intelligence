BEGIN;
DROP FUNCTION dna.read_paid_tournament_review_events(uuid,uuid);
DROP FUNCTION dna.read_paid_tournament_review_queue(uuid,integer);
DROP FUNCTION dna.enqueue_paid_tournament_review(
  uuid,uuid,text,text,text,text,text,text,text,text,text,text,
  timestamptz,timestamptz,text,timestamptz,timestamptz);
DROP TABLE dna.paid_tournament_review_event;
DROP TABLE dna.paid_tournament_review_queue;
COMMIT;
