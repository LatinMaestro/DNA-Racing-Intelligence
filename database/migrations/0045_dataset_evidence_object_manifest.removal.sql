DO $dataset_evidence_object_removal$
BEGIN
  IF to_regclass('dna.dataset_evidence_object') IS NOT NULL
     OR to_regprocedure(
       'dna.register_dataset_evidence_object(uuid,uuid,text,text,integer,text,text,character,bigint,bigint,text,text,timestamp with time zone)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'dataset evidence object boundary was not removed';
  END IF;
END
$dataset_evidence_object_removal$;
