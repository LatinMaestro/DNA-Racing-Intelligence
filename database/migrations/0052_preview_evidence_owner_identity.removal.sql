DO $check$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'dna.record_import_preview_evidence_receipts(uuid,uuid,jsonb)'::regprocedure
  ) INTO v_definition;

  IF v_definition LIKE '%v_authenticated_owner_id%'
     OR v_definition LIKE '%clerk_user_id%' THEN
    RAISE EXCEPTION 'Preview evidence authenticated-owner identity repair still exists';
  END IF;
END
$check$;
