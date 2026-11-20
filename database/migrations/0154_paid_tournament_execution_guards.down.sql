BEGIN;
DROP FUNCTION dna.read_paid_tournament_segment_guards(uuid,integer);
DROP FUNCTION dna.read_race_entry_owner_control(uuid);
DROP FUNCTION dna.configure_paid_tournament_segment_guard(
  uuid,uuid,text,text,text,text,text,text,text,integer,numeric,numeric,numeric,
  numeric,numeric,timestamptz,timestamptz);
DROP FUNCTION dna.configure_race_entry_owner_control(
  uuid,uuid,text,text,boolean,boolean,timestamptz,timestamptz);
DROP TABLE dna.paid_tournament_segment_guard_event;
DROP TABLE dna.paid_tournament_segment_guard;
DROP TABLE dna.race_entry_owner_control_event;
DROP TABLE dna.race_entry_owner_control;
COMMIT;
