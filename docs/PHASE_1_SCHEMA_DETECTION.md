# Phase 1 Schema Detection and Staged Validation

Date: 22 July 2026  
Status: verified for Phase 1  
Deployment scope: repository and synthetic tests only

## Purpose

The schema detector identifies the four supported private CSV families before any row is normalized or persisted. It combines an optional explicit source selection with header-based detection, records the detected encoding and schema version, and fails closed when the shape is unsupported or ambiguous.

The supported versioned schemas are:

- `race-merge/v1`;
- `core-details/v1`;
- `current-vault/v1`; and
- `current-arena/v1`.

The historical Bike-labelled export is `core-details/v1`. Its `bikeid` header is a versioned source alias for normalized `core_id`; it is not bike-only data.

## Staging contract

Each staged header produces:

- a `ready` or `quarantined` status;
- the detected source type and schema version when unambiguous;
- UTF-8, Windows-1252, other or unknown encoding status;
- source column index, raw header, normalized header and canonical column provenance; and
- stable issue codes with severity and occurrence count.

Raw headers belong only to the private staging result. The logging contract returns source type, version, encoding, column counts and issue codes. It never returns filenames, raw headers, source rows or values.

## Fail-closed rules

The detector quarantines input when:

- an explicit source selection contradicts the required header shape;
- no supported schema matches;
- multiple schemas match without an explicit selection;
- two source headers map to the same canonical column;
- a required column is missing;
- the CSV header is malformed; or
- the sampled encoding is unsupported or contains binary control bytes.

Unknown extra columns are retained in column provenance and reported as a warning count. They do not silently become normalized facts and do not block a schema whose required columns are otherwise valid.

Schema readiness is not import acceptance. Row adapters, value validation, transactional persistence, dataset activation and rollback remain later Phase 1 slices.

## Verification

Synthetic tests cover all four schema families, the legacy `bikeid` alias, explicit-selection mismatch, duplicate canonical aliases, ambiguous combined headers, malformed CSV, Windows-1252 detection, binary-control rejection and redacted count-only summaries.

The supplied private files informed only the schema registry and encoding requirement. No source rows, filenames, private values or user-derived outputs are committed.
