import type {
  BoundedImportProcessor,
  PreparedImportResult,
} from "./import-background-processing-service";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export type AcceptedDatasetPreparationRepository = Readonly<{
  prepareAcceptedDataset: (input: {
    ownerId: string;
    updateSessionId: string;
    dispatchId: string;
    previewFingerprintSha256: string;
    maximumSourceVersions: number;
  }) => Promise<PreparedImportResult>;
}>;

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function safeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function normalizeResult(
  value: PreparedImportResult,
  maximumSourceVersions: number,
  maximumQuarantinedRecords: number,
): PreparedImportResult {
  const preparedResultId = safeIdentifier(
    value.preparedResultId,
    "preparedResultId",
  );
  if (
    !Number.isSafeInteger(value.sourceVersionCount) ||
    value.sourceVersionCount <= 0 ||
    value.sourceVersionCount > maximumSourceVersions
  ) {
    throw new Error("sourceVersionCount exceeds the accepted dataset bound");
  }
  if (
    !Number.isSafeInteger(value.quarantinedRecordCount) ||
    value.quarantinedRecordCount < 0 ||
    value.quarantinedRecordCount > maximumQuarantinedRecords
  ) {
    throw new Error(\n      "quarantinedRecordCount exceeds the accepted dataset bound",\n    );
  }
  if (
    value.aggregateRefreshRequired !== true &&
    value.aggregateRefreshRequired !== false
  ) {
    throw new Error("aggregateRefreshRequired must be a Boolean");
  }
  return Object.freeze({
    preparedResultId,
    sourceVersionCount: value.sourceVersionCount,
    quarantinedRecordCount: value.quarantinedRecordCount,
    aggregateRefreshRequired: value.aggregateRefreshRequired,
  });
}

export function createBoundedAcceptedDatasetProcessor(input: {
  repository: AcceptedDatasetPreparationRepository;
  maximumSourceVersions: number;
  maximumQuarantinedRecords: number;
}): BoundedImportProcessor {
  const maximumSourceVersions = positiveSafeInteger(
    input.maximumSourceVersions,
    "maximumSourceVersions",
  );
  const maximumQuarantinedRecords = positiveSafeInteger(
    input.maximumQuarantinedRecords,
    "maximumQuarantinedRecords",
  );

  return Object.freeze({
    async prepare(prepareInput) {
      const ownerId = safeIdentifier(prepareInput.ownerId, "ownerId");
      const updateSessionId = safeIdentifier(
        prepareInput.updateSessionId,
        "updateSessionId",
      );
      const dispatchId = safeIdentifier(prepareInput.dispatchId, "dispatchId");
      if (!SHA_256_PATTERN.test(prepareInput.previewFingerprintSha256)) {
        throw new Error("previewFingerprintSha256 is invalid");
      }

      const result = await input.repository.prepareAcceptedDataset({
        ownerId,
        updateSessionId,
        dispatchId,
        previewFingerprintSha256: prepareInput.previewFingerprintSha256,
        maximumSourceVersions,
      });
      return normalizeResult(
        result,
        maximumSourceVersions,
        maximumQuarantinedRecords,
      );
    },
  });
}
