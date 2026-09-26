import {
  dnaOpenLabRawEvidenceCanonicalJson,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MODES = new Set(["bike", "car", "horse"]);

export const DNA_POPULATION_ENTRANT_AUTHORITY_QUARANTINE_REASONS = [
  "provider_document_missing",
  "provider_document_unusable",
  "entrant_authority_unresolved",
] as const;

export type DnaPopulationEntrantAuthorityQuarantineReason =
  (typeof DNA_POPULATION_ENTRANT_AUTHORITY_QUARANTINE_REASONS)[number];

export type DnaPopulationEntrantAuthorityResolvedRecord = Readonly<{
  sourceRaceId: string;
  observedAt: string;
  rawEvidenceSha256: string;
  mode?: "bike" | "car" | "horse";
  modeEvidenceStatus?: "unsupported_source_value";
  entrantCoreIds?: readonly string[];
  entrantCoreIdsEvidenceStatus?: "unsupported_source_value";
  quarantineReason?: never;
  sourceEvidenceSha256?: never;
}>;

export type DnaPopulationEntrantAuthorityQuarantineRecord = Readonly<{
  sourceRaceId: string;
  observedAt: string;
  quarantineReason: DnaPopulationEntrantAuthorityQuarantineReason;
  sourceEvidenceSha256?: string;
  rawEvidenceSha256?: never;
  mode?: never;
  modeEvidenceStatus?: never;
  entrantCoreIds?: never;
  entrantCoreIdsEvidenceStatus?: never;
}>;

export type DnaPopulationEntrantAuthorityRecord =
  | DnaPopulationEntrantAuthorityResolvedRecord
  | DnaPopulationEntrantAuthorityQuarantineRecord;

function authorityError(message: string): never {
  throw new Error(`Population entrant authority record: ${message}`);
}

function safeRaceId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    CONTROL_PATTERN.test(value)
  ) {
    authorityError("source Race ID is invalid");
  }
  return value;
}

function timestamp(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    Number.isNaN(Date.parse(value))
  ) {
    authorityError("observation timestamp is invalid");
  }
  return new Date(value).toISOString();
}

function sha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    authorityError("raw evidence SHA-256 is invalid");
  }
  return normalized;
}

function entrantIds(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const normalized = values.map((value) => {
    if (
      typeof value !== "string" ||
      !POSITIVE_INTEGER_PATTERN.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      seen.has(value)
    ) {
      authorityError("entrant Core IDs are invalid");
    }
    seen.add(value);
    return value;
  });
  return Object.freeze(normalized);
}


function quarantineReason(
  value: DnaPopulationEntrantAuthorityQuarantineReason,
): DnaPopulationEntrantAuthorityQuarantineReason {
  if (
    !DNA_POPULATION_ENTRANT_AUTHORITY_QUARANTINE_REASONS.includes(value)
  ) {
    authorityError("quarantine reason is invalid");
  }
  return value;
}

export function dnaPopulationEntrantAuthorityQuarantineRecord(input: {
  sourceRaceId: string;
  observedAt: string;
  quarantineReason: DnaPopulationEntrantAuthorityQuarantineReason;
  sourceEvidenceSha256?: string;
}): DnaPopulationEntrantAuthorityQuarantineRecord {
  return Object.freeze({
    sourceRaceId: safeRaceId(input.sourceRaceId),
    observedAt: timestamp(input.observedAt),
    quarantineReason: quarantineReason(input.quarantineReason),
    ...(input.sourceEvidenceSha256 === undefined
      ? {}
      : { sourceEvidenceSha256: sha256(input.sourceEvidenceSha256) }),
  });
}

export function isDnaPopulationEntrantAuthorityQuarantineRecord(
  record: DnaPopulationEntrantAuthorityRecord,
): record is DnaPopulationEntrantAuthorityQuarantineRecord {
  return "quarantineReason" in record;
}

/**
 * Retains only the canonical fields required to prove all-mode population
 * entrant authority while binding them to the exact raw-provider checksum.
 * The full provider response is deliberately not copied into this record.
 *
 * This is an evidence transformation only. It performs no provider access and
 * no persistence.
 */
export function dnaPopulationEntrantAuthorityRecord(
  evidence: DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>,
): DnaPopulationEntrantAuthorityRecord {
  const canonical = evidence.canonical;
  if (
    evidence.source !== "dna_open_lab" ||
    evidence.sourceVersion !== "v1" ||
    evidence.scope !== "races" ||
    evidence.endpoint !== "races.docs" ||
    canonical.sourceType !== "race_document"
  ) {
    authorityError("Race evidence source is invalid");
  }
  const sourceRaceId = safeRaceId(canonical.sourceRaceId);
  if (evidence.entityKey !== `race:${sourceRaceId}`) {
    authorityError("Race evidence identity is invalid");
  }

  const mode =
    canonical.mode === undefined
      ? undefined
      : MODES.has(canonical.mode)
        ? canonical.mode
        : authorityError("Race mode is invalid");
  const modeEvidenceStatus = canonical.modeEvidenceStatus;
  if (
    modeEvidenceStatus !== undefined &&
    modeEvidenceStatus !== "unsupported_source_value"
  ) {
    authorityError("Race mode evidence status is invalid");
  }
  if (mode !== undefined && modeEvidenceStatus !== undefined) {
    authorityError("Race mode authority is contradictory");
  }

  const coreIds =
    canonical.entrantCoreIds === undefined
      ? undefined
      : entrantIds(canonical.entrantCoreIds);
  const entrantCoreIdsEvidenceStatus = canonical.entrantCoreIdsEvidenceStatus;
  if (
    entrantCoreIdsEvidenceStatus !== undefined &&
    entrantCoreIdsEvidenceStatus !== "unsupported_source_value"
  ) {
    authorityError("entrant authority status is invalid");
  }
  if (coreIds !== undefined && entrantCoreIdsEvidenceStatus !== undefined) {
    authorityError("entrant authority is contradictory");
  }

  return Object.freeze({
    sourceRaceId,
    observedAt: timestamp(evidence.observedAt),
    rawEvidenceSha256: sha256(evidence.rawEvidenceSha256),
    ...(mode === undefined ? {} : { mode }),
    ...(modeEvidenceStatus === undefined ? {} : { modeEvidenceStatus }),
    ...(coreIds === undefined ? {} : { entrantCoreIds: coreIds }),
    ...(entrantCoreIdsEvidenceStatus === undefined
      ? {}
      : { entrantCoreIdsEvidenceStatus }),
  });
}

export function dnaPopulationEntrantAuthorityRecordBytes(
  evidence: DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>,
): number {
  return Buffer.byteLength(
    dnaOpenLabRawEvidenceCanonicalJson(
      dnaPopulationEntrantAuthorityRecord(evidence),
    ),
    "utf8",
  );
}
