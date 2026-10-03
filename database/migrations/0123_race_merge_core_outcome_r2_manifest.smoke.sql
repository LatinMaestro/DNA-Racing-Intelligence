BEGIN;
DO $smoke$
DECLARE
  v_owner uuid := '91230000-0000-4000-8000-000000000001';
  v_generation text := 'smoke-r2-generation';
  v_receipt jsonb;
  v_digest text;
  v_row dna.race_merge_core_outcome_r2_generation%ROWTYPE;
BEGIN
  INSERT INTO dna.app_owner(id, clerk_user_id) VALUES(v_owner, 'smoke_race_merge_r2_owner');
  PERFORM set_config('app.owner_id',v_owner::text,true);
  v_receipt := jsonb_build_object('version',1,'generationId',v_generation,'sourceCoreId',41,'objectKey','private/race-merge/core-41.json','bodySha256',repeat('b',64),'byteLength',512,'uniqueOutcomeCount',2,'sourceObservationCount',3,'firstSourceRaceId','race-1','lastSourceRaceId','race-2');
  SELECT encode(sha256(convert_to(
    '1:1'||length(v_generation)::text||':'||v_generation||'2:41'||length('private/race-merge/core-41.json')::text||':private/race-merge/core-41.json'||'64:'||repeat('b',64)||'3:512'||'1:2'||'1:3'||'6:race-1'||'6:race-2'||E'\n','UTF8')),'hex') INTO v_digest;
  SELECT * INTO v_row FROM dna.begin_race_merge_core_outcome_r2_generation(v_owner,jsonb_build_object('version',1,'generationId',v_generation,'cohortOrdinal',1,'firstSourceCoreId',41,'lastSourceCoreId',41,'coreCount',1,'uniqueOutcomeCount',2,'sourceObservationCount',3,'retainedR2Bytes',512,'receiptSetSha256',v_digest),clock_timestamp());
  IF v_row.state<>'writing' THEN RAISE EXCEPTION 'generation did not begin'; END IF;
  SELECT * INTO v_row FROM dna.register_race_merge_core_outcome_r2_manifest(v_owner,v_generation,1,v_receipt,clock_timestamp());
  SELECT * INTO v_row FROM dna.register_race_merge_core_outcome_r2_manifest(v_owner,v_generation,1,v_receipt,clock_timestamp());
  IF v_row.registered_core_count<>1 THEN RAISE EXCEPTION 'exact replay was not idempotent'; END IF;
  SELECT * INTO v_row FROM dna.finalize_race_merge_core_outcome_r2_generation(v_owner,v_generation,1,v_digest,clock_timestamp());
  IF v_row.state<>'complete' OR (SELECT count(*) FROM dna.read_race_merge_core_outcome_r2_manifests(v_owner,v_generation,1,0,100))<>1 THEN RAISE EXCEPTION 'generation did not finalize'; END IF;
  BEGIN UPDATE dna.race_merge_core_outcome_r2_manifest SET byte_length=513 WHERE owner_id=v_owner; RAISE EXCEPTION 'manifest update unexpectedly succeeded'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='manifest update unexpectedly succeeded' THEN RAISE; END IF; END;
  BEGIN DELETE FROM dna.race_merge_core_outcome_r2_manifest WHERE owner_id=v_owner; RAISE EXCEPTION 'manifest delete unexpectedly succeeded'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='manifest delete unexpectedly succeeded' THEN RAISE; END IF; END;
END $smoke$;
ROLLBACK;
