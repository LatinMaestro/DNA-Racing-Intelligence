BEGIN;
DROP FUNCTION IF EXISTS dna.publish_open_race_field_lock(uuid,text,text,text,timestamptz,text,text);
COMMIT;
