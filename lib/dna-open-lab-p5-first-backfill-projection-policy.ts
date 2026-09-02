import type {
  DnaOpenLabP5FirstBackfillFamilyObservation,
  DnaOpenLabP5FirstBackfillFamilyUpperBounds,
} from "./dna-open-lab-p5-first-backfill-family-adapter";

/**
 * Versioned, deliberately conservative conversion from terminal read-only API
 * observations to the provider bounds used by the first-backfill decision
 * packet. None of these constants are provider prices.
 */
export const DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY = Object.freeze({
  version: 2 as const,
  r2StandardOnly: true as const,
  r2MaximumEvidenceObjectBytes: 8 * 1024 * 1024,
  r2EvidenceEnvelopeBytesPerLogicalRequest: 16_384,
  apiRequestAttemptsPerLogicalRequest: 2,
  r2PutAttemptsPerLogicalRequest: 2,
  r2AuditListPasses: 2,
  r2ListPageObjectLimit: 1_000,
  r2ClassBOperationsPerLogicalRequest: 6,
  historicalArchiveNeonPhysicalBytesPerLogicalRequest: 24_576,
  currentStateNeonPhysicalBytesPerSourceRecord: 16_384,
  currentStateNeonControlBytesPerLogicalRequest: 8_192,
  neonControlBytesPerFamily: 2_097_152,
});

function projectionError(message: string): never {
  throw new Error(
    `DNA Open Lab P5 first backfill projection policy: ${message}`,
  );
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    projectionError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function positiveCount(value: number, field: string): number {
  const result = count(value, field);
  if (result < 1) projectionError(`${field} must be positive`);
  return result;
}

function checked(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    projectionError(`${field} exceeds safe integer range`);
  }
  return Number(value);
}

function multiply(value: number, multiplier: number, field: string): number {
  return checked(BigInt(value) * BigInt(multiplier), field);
}

function add(values: readonly number[], field: string): number {
  return checked(
    values.reduce((total, value) => total + BigInt(value), 0n),
    field,
  );
}

/**
 * Projects one already exhausted source family.
 *
 * R2 retains one immutable evidence object per logical API request. The body
 * allowance adds a fixed 16 KiB canonical request/rate/receipt envelope and
 * assumes no compression. Operation bounds allow one replay of every PUT, two
 * complete paginated audit listings and six reads per logical object.
 *
 * Compact Neon does not retain raw API bodies. Finished-race history is
 * archive-first: private immutable R2 remains the complete evidence boundary,
 * while Neon retains only bounded window receipts/checkpoints and aggregate
 * generation controls. The historical bound therefore charges 24 KiB of
 * physical heap/index/overlap allowance per logical request and no per-race
 * row allowance.
 *
 * Recurring current-state families are intentionally materialized in Neon.
 * Their bound charges 16 KiB per observed source record, 8 KiB per logical
 * request and 2 MiB per family for generation/control/index overhead. These
 * physical allowances include candidate/last-good overlap; raw response bytes
 * remain recoverable from R2 and are never duplicated into Neon.
 */
export function projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(
  observation: DnaOpenLabP5FirstBackfillFamilyObservation,
): DnaOpenLabP5FirstBackfillFamilyUpperBounds {
  const historicalArchive =
    observation.authorityClass === "available_paginated_history_at_cutoff";
  if (historicalArchive !== (observation.family === "finished_races")) {
    projectionError("source family and authority class do not match");
  }
  const sourceRecords = count(
    observation.observedSourceRecordCount,
    "observedSourceRecordCount",
  );
  const unresolvedIdentityObservationUpperBound = count(
    observation.unresolvedIdentityObservationUpperBound,
    "unresolvedIdentityObservationUpperBound",
  );
  const projectedSourceRecords = add(
    [sourceRecords, unresolvedIdentityObservationUpperBound],
    "projected source records",
  );
  const logicalRequests = positiveCount(
    observation.observedApiRequestCount,
    "observedApiRequestCount",
  );
  const responseBytes = positiveCount(
    observation.observedResponseBytes,
    "observedResponseBytes",
  );
  const maximumResponseBytes = positiveCount(
    observation.maximumObservedResponseBytes,
    "maximumObservedResponseBytes",
  );
  const policy = DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY;
  if (maximumResponseBytes > responseBytes) {
    projectionError("maximumObservedResponseBytes exceeds family bytes");
  }
  if (
    add(
      [maximumResponseBytes, policy.r2EvidenceEnvelopeBytesPerLogicalRequest],
      "maximum R2 evidence object bytes",
    ) > policy.r2MaximumEvidenceObjectBytes
  ) {
    projectionError("R2 evidence object capacity would be exceeded");
  }

  const apiRequestUpperBound = multiply(
    logicalRequests,
    policy.apiRequestAttemptsPerLogicalRequest,
    "apiRequestUpperBound",
  );
  const retainedR2BytesUpperBound = add(
    [
      responseBytes,
      multiply(
        logicalRequests,
        policy.r2EvidenceEnvelopeBytesPerLogicalRequest,
        "R2 envelope bytes",
      ),
    ],
    "retainedR2BytesUpperBound",
  );
  const auditListPages = Math.ceil(
    logicalRequests / policy.r2ListPageObjectLimit,
  );
  const classAOperationsUpperBound = add(
    [
      multiply(
        logicalRequests,
        policy.r2PutAttemptsPerLogicalRequest,
        "R2 PUT attempts",
      ),
      multiply(
        auditListPages,
        policy.r2AuditListPasses,
        "R2 audit LIST operations",
      ),
    ],
    "classAOperationsUpperBound",
  );
  const classBOperationsUpperBound = multiply(
    logicalRequests,
    policy.r2ClassBOperationsPerLogicalRequest,
    "classBOperationsUpperBound",
  );
  const neonIncrementalBytesUpperBound = historicalArchive
    ? add(
        [
          multiply(
            logicalRequests,
            policy.historicalArchiveNeonPhysicalBytesPerLogicalRequest,
            "historical archive Neon request bytes",
          ),
          policy.neonControlBytesPerFamily,
        ],
        "neonIncrementalBytesUpperBound",
      )
    : add(
        [
          multiply(
            projectedSourceRecords,
            policy.currentStateNeonPhysicalBytesPerSourceRecord,
            "current-state Neon record bytes",
          ),
          multiply(
            logicalRequests,
            policy.currentStateNeonControlBytesPerLogicalRequest,
            "current-state Neon request control bytes",
          ),
          policy.neonControlBytesPerFamily,
        ],
        "neonIncrementalBytesUpperBound",
      );

  return Object.freeze({
    sourceRecordUpperBound: projectedSourceRecords,
    apiRequestUpperBound,
    retainedR2BytesUpperBound,
    classAOperationsUpperBound,
    classBOperationsUpperBound,
    neonIncrementalBytesUpperBound,
    unresolvedIdentityObservationUpperBound,
  });
}
