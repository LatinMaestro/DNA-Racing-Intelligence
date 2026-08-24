DO $removal$
BEGIN
  IF to_regclass('dna.race_archive_core_locator') IS NOT NULL THEN
    RAISE EXCEPTION 'race_archive_core_locator still exists after reversal';
  END IF;
  IF to_regclass('dna.race_archive_core_locator_receipt') IS NOT NULL THEN
    RAISE EXCEPTION 'race_archive_core_locator_receipt still exists after reversal';
  END IF;
  IF to_regprocedure(
    'dna.replace_race_archive_core_locators(uuid,uuid,uuid,character,jsonb,timestamp with time zone)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'replace_race_archive_core_locators still exists after reversal';
  END IF;
  IF to_regprocedure(
    'dna.list_race_archive_core_locators(uuid,text,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'list_race_archive_core_locators still exists after reversal';
  END IF;
END
$removal$;