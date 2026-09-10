import {
  adaptDnaRaceDocument,
  dnaOpenLabRawEvidenceSha256,
  DnaRaceDocumentAdaptationProcessingError,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";
import type {
  DnaOpenLabClient,
  DnaRaceDocument,
  DnaRaceIdentifier,
} from "./dna-open-lab-v1-client";
import type { DnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";

export const DNA_RACE_DOCUMENT_BATCH_LIMIT = 20 as const;

export type DnaRaceDocumentHydrationResult = Readonly<{
  documents: readonly DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>[];
  requestedRaceCount: number;
  batchCount: number;
}>;

export class DnaRaceDocumentHydrationError extends Error {
  readonly kind:
    | "invalid_request"
    | "invalid_response"
    | "missing_document"
    | "unexpected_document"
    | "duplicate_document"
    | "conflicting_document";

  constructor(input: {
    kind: DnaRaceDocumentHydrationError["kind"];
    message: string;
  }) {
    super(input.message);
    this.name = "DnaRaceDocumentHydrationError";
    this.kind = input.kind;
  }
}

export type DnaRaceDocumentHydrationProcessingDiagnostic =
  | "race_document_hydration_input_processing_unavailable"
  | "race_document_hydration_response_processing_unavailable"
  | "race_document_hydration_response_identity_processing_unavailable"
  | "race_document_hydration_response_hash_processing_unavailable"
  | "race_document_hydration_response_adaptation_processing_unavailable"
  | "race_document_adaptation_identity_unavailable"
  | "race_document_adaptation_descriptor_unavailable"
  | "race_document_adaptation_status_unavailable"
  | "race_document_adaptation_name_unavailable"
  | "race_document_adaptation_mode_unavailable"
  | "race_document_adaptation_mode_type_unavailable"
  | "race_document_adaptation_mode_blank_unavailable"
  | "race_document_adaptation_mode_vocabulary_unavailable"
  | "race_document_adaptation_format_unavailable"
  | "race_document_adaptation_class_unavailable"
  | "race_document_adaptation_participation_unavailable"
  | "race_document_adaptation_economics_unavailable"
  | "race_document_adaptation_fixed_fees_unavailable"
  | "race_document_adaptation_entry_fee_usd_unavailable"
  | "race_document_adaptation_payment_asset_unavailable"
  | "race_document_adaptation_payout_unavailable"
  | "race_document_adaptation_prize_unavailable"
  | "race_document_adaptation_prize_type_unavailable"
  | "race_document_adaptation_prize_null_unavailable"
  | "race_document_adaptation_prize_non_numeric_unavailable"
  | "race_document_adaptation_prize_value_unavailable"
  | "race_document_adaptation_prize_usd_unavailable"
  | "race_document_adaptation_schedule_unavailable"
  | "race_document_adaptation_results_unavailable"
  | "race_document_adaptation_evidence_unavailable"
  | "race_document_hydration_response_coverage_processing_unavailable"
  | "race_document_hydration_result_processing_unavailable";

export class DnaRaceDocumentHydrationProcessingError extends Error {
  readonly diagnostic: DnaRaceDocumentHydrationProcessingDiagnostic;

  constructor(diagnostic: DnaRaceDocumentHydrationProcessingDiagnostic) {
    super("DNA race-document hydration processing is unavailable");
    this.name = "DnaRaceDocumentHydrationProcessingError";
    this.diagnostic = diagnostic;
  }
}

function processHydrationBoundary<T>(
  diagnostic: DnaRaceDocumentHydrationProcessingDiagnostic,
  operation: () => T,
): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DnaRaceDocumentAdaptationProcessingError) {
      throw new DnaRaceDocumentHydrationProcessingError(error.diagnostic);
    }
    if (
      error instanceof DnaRaceDocumentHydrationError ||
      error instanceof DnaRaceDocumentHydrationProcessingError
    ) {
      throw error;
    }
    throw new DnaRaceDocumentHydrationProcessingError(diagnostic);
  }
}

function hydrationError(
  kind: DnaRaceDocumentHydrationError["kind"],
  message: string,
): never {
  throw new DnaRaceDocumentHydrationError({ kind, message });
}

function raceKey(rid: DnaRaceIdentifier): string {
  if (typeof rid === "number") {
    if (!Number.isSafeInteger(rid) || rid < 1) {
      hydrationError(
        "invalid_request",
        "race id must be a positive safe integer",
      );
    }
    return String(rid);
  }
  const normalized = rid.trim();
  if (normalized === "") {
    hydrationError("invalid_request", "race id must not be empty");
  }
  return normalized;
}

function batches<T>(
  values: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

/**
 * Hydrates discovered race ids through DNA's bounded `/races/docs` endpoint.
 * Every request is routed through the shared request budget, and every batch
 * must return exactly one document for every requested race id before any
 * hydrated evidence is exposed to later checkpoint or persistence layers.
 */
export async function hydrateDnaRaceDocuments(input: {
  raceIds: readonly DnaRaceIdentifier[];
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  observedAt: string;
}): Promise<DnaRaceDocumentHydrationResult> {
  const { requestedKeys, requestBatches } = processHydrationBoundary(
    "race_document_hydration_input_processing_unavailable",
    () => {
      if (input.raceIds.length < 1) {
        hydrationError("invalid_request", "at least one race id is required");
      }

      const keys = input.raceIds.map((rid) => raceKey(rid));
      const uniqueRequestedKeys = new Set(keys);
      if (uniqueRequestedKeys.size !== keys.length) {
        hydrationError("invalid_request", "requested race ids must be unique");
      }
      return Object.freeze({
        requestedKeys: keys,
        requestBatches: batches(input.raceIds, DNA_RACE_DOCUMENT_BATCH_LIMIT),
      });
    },
  );

  const evidenceByKey = new Map<
    string,
    Readonly<{
      hash: string;
      evidence: DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>;
    }>
  >();
  for (const batch of requestBatches) {
    const batchKeys = processHydrationBoundary(
      "race_document_hydration_input_processing_unavailable",
      () => new Set(batch.map((rid) => raceKey(rid))),
    );
    const response = await input.requestBudget.execute(() =>
      input.client.raceDocs(batch),
    );
    processHydrationBoundary(
      "race_document_hydration_response_processing_unavailable",
      () => {
        if (!Array.isArray(response.result)) {
          hydrationError(
            "invalid_response",
            "DNA race-doc hydration result must be an array",
          );
        }

        const returnedKeys = new Set<string>();
        for (const document of response.result) {
          const key = processHydrationBoundary(
            "race_document_hydration_response_identity_processing_unavailable",
            () => raceKey(document.rid),
          );
          if (!batchKeys.has(key)) {
            hydrationError(
              "unexpected_document",
              `DNA race-doc hydration returned unexpected race ${key}`,
            );
          }

          const hash = processHydrationBoundary(
            "race_document_hydration_response_hash_processing_unavailable",
            () => dnaOpenLabRawEvidenceSha256(document),
          );
          const existing = evidenceByKey.get(key);
          if (returnedKeys.has(key) || existing !== undefined) {
            if (existing !== undefined && existing.hash !== hash) {
              hydrationError(
                "conflicting_document",
                `DNA race-doc hydration returned conflicting documents for race ${key}`,
              );
            }
            hydrationError(
              "duplicate_document",
              `DNA race-doc hydration returned duplicate race ${key}`,
            );
          }

          returnedKeys.add(key);
          const evidence = processHydrationBoundary(
            "race_document_hydration_response_adaptation_processing_unavailable",
            () =>
              adaptDnaRaceDocument({
                raw: document as DnaRaceDocument,
                observedAt: input.observedAt,
                endpoint: "races.docs",
              }),
          );
          evidenceByKey.set(key, Object.freeze({ hash, evidence }));
        }

        processHydrationBoundary(
          "race_document_hydration_response_coverage_processing_unavailable",
          () => {
            for (const key of batchKeys) {
              if (!returnedKeys.has(key)) {
                hydrationError(
                  "missing_document",
                  `DNA race-doc hydration did not return requested race ${key}`,
                );
              }
            }
          },
        );
      },
    );
  }

  return processHydrationBoundary(
    "race_document_hydration_result_processing_unavailable",
    () => {
      const documents = Object.freeze(
        requestedKeys.map((key) => {
          const entry = evidenceByKey.get(key);
          if (entry === undefined) {
            return hydrationError(
              "missing_document",
              `DNA race-doc hydration did not materialize requested race ${key}`,
            );
          }
          return entry.evidence;
        }),
      );

      return Object.freeze({
        documents,
        requestedRaceCount: requestedKeys.length,
        batchCount: requestBatches.length,
      });
    },
  );
}
