import {
  adaptDnaRaceDocument,
  dnaOpenLabRawEvidenceSha256,
  DnaRaceDocumentAdaptationProcessingError,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";
import {
  DnaRaceDocumentHydrationError,
  DNA_RACE_DOCUMENT_BATCH_LIMIT,
} from "./dna-open-lab-race-document-hydrator";
import type { DnaPopulationEntrantAuthorityQuarantineReason } from "./dna-population-entrant-authority-record";
import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaRaceDocument,
  type DnaRaceIdentifier,
} from "./dna-open-lab-v1-client";
import type { DnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";

export type DnaRaceDocumentQuarantineHydrationOutcome =
  | Readonly<{
      status: "resolved";
      sourceRaceId: string;
      evidence: DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>;
    }>
  | Readonly<{
      status: "quarantined";
      sourceRaceId: string;
      observedAt: string;
      quarantineReason: DnaPopulationEntrantAuthorityQuarantineReason;
      sourceEvidenceSha256?: string;
    }>;

type DnaRaceDocumentQuarantineOutcome =
  DnaRaceDocumentQuarantineHydrationOutcome;
type DnaRaceDocumentQuarantineOnlyOutcome = Extract<
  DnaRaceDocumentQuarantineHydrationOutcome,
  { status: "quarantined" }
>;

export type DnaRaceDocumentQuarantineHydrationResult = Readonly<{
  outcomes: readonly DnaRaceDocumentQuarantineHydrationOutcome[];
  requestedRaceCount: number;
  batchCount: number;
  providerRequestCount: number;
  resolvedRaceCount: number;
  quarantinedRaceCount: number;
}>;

function hydrationError(
  kind: DnaRaceDocumentHydrationError["kind"],
  message: string,
): never {
  throw new DnaRaceDocumentHydrationError({ kind, message });
}

function raceKey(rid: DnaRaceIdentifier): string {
  if (typeof rid === "number") {
    if (!Number.isSafeInteger(rid) || rid < 1) {
      hydrationError("invalid_request", "race id is invalid");
    }
    return String(rid);
  }
  if (typeof rid !== "string") {
    hydrationError("invalid_request", "race id is invalid");
  }
  const normalized = rid.trim();
  if (normalized.length < 1 || normalized !== rid) {
    hydrationError("invalid_request", "race id is invalid");
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
  return Object.freeze(result.map((batch) => Object.freeze(batch)));
}

const DNA_RACE_DOCUMENT_HYDRATION_CONCURRENCY = 3;
export const DNA_RACE_DOCUMENT_MALFORMED_RESPONSE_MAX_ATTEMPTS = 3 as const;
export const DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS = 3 as const;
export const DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS = 3 as const;
export const DNA_RACE_DOCUMENT_SYSTEMIC_INDIVIDUAL_PROBE_ATTEMPTS = 3 as const;

async function forEachWithConcurrency<T>(
  values: readonly T[],
  maximumConcurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      await operation(values[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(maximumConcurrency, values.length) }, worker),
  );
}

async function raceDocsWithProviderRetry(input: {
  batch: readonly DnaRaceIdentifier[];
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  onRequest?: () => void;
}) {
  const maximumAttempts = Math.max(
    DNA_RACE_DOCUMENT_MALFORMED_RESPONSE_MAX_ATTEMPTS,
    DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS,
  );
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      input.onRequest?.();
      return await input.requestBudget.execute(() =>
        input.client.raceDocs(input.batch),
      );
    } catch (error) {
      const retryLimit =
        error instanceof DnaOpenLabApiError &&
        error.kind === "malformed_response"
          ? DNA_RACE_DOCUMENT_MALFORMED_RESPONSE_MAX_ATTEMPTS
          : error instanceof DnaOpenLabApiError &&
              error.kind === "transport_error"
            ? DNA_RACE_DOCUMENT_TRANSPORT_ERROR_MAX_ATTEMPTS
            : 0;
      if (retryLimit === 0 || attempt >= retryLimit) {
        throw error;
      }
    }
  }
  throw new Error("unreachable provider retry state");
}

function resolvedEntrantAuthority(
  canonical: CanonicalRaceDocumentMetadata,
): boolean {
  return (
    (canonical.mode === "bike" ||
      canonical.mode === "car" ||
      canonical.mode === "horse") &&
    Array.isArray(canonical.entrantCoreIds) &&
    canonical.entrantCoreIds.length > 0
  );
}

function quarantined(input: {
  sourceRaceId: string;
  observedAt: string;
  quarantineReason: DnaPopulationEntrantAuthorityQuarantineReason;
  sourceEvidenceSha256?: string;
}): DnaRaceDocumentQuarantineHydrationOutcome {
  return Object.freeze({
    status: "quarantined" as const,
    sourceRaceId: input.sourceRaceId,
    observedAt: input.observedAt,
    quarantineReason: input.quarantineReason,
    ...(input.sourceEvidenceSha256 === undefined
      ? {}
      : { sourceEvidenceSha256: input.sourceEvidenceSha256 }),
  });
}

/**
 * Hydrates one deterministic unresolved-Race cohort without allowing isolated
 * Race-specific failures to stall the wider population build.
 *
 * Provider/request failures, unexpected/duplicate identities and a whole
 * multi-Race batch returning no documents remain systemic failures. A successful
 * response may quarantine an individual requested Race when that Race is
 * missing, its returned document cannot be adapted, or its adapted document
 * still lacks trustworthy mode/entrant authority.
 */
export async function hydrateDnaRaceDocumentsWithQuarantine(input: {
  raceIds: readonly DnaRaceIdentifier[];
  client: Pick<DnaOpenLabClient, "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  observedAt: string;
}): Promise<DnaRaceDocumentQuarantineHydrationResult> {
  if (input.raceIds.length < 1) {
    hydrationError("invalid_request", "at least one race id is required");
  }
  const requestedKeys = input.raceIds.map(raceKey);
  if (new Set(requestedKeys).size !== requestedKeys.length) {
    hydrationError("invalid_request", "requested race ids must be unique");
  }

  const outcomesByKey = new Map<
    string,
    DnaRaceDocumentQuarantineHydrationOutcome
  >();
  const requestBatches = batches(input.raceIds, DNA_RACE_DOCUMENT_BATCH_LIMIT);
  let providerRequestCount = 0;

  await forEachWithConcurrency(
    requestBatches,
    DNA_RACE_DOCUMENT_HYDRATION_CONCURRENCY,
    async (batch) => {
      const batchKeys = batch.map(raceKey);
      const batchKeySet = new Set(batchKeys);
      const stableBatchQuarantines = new Map<
        string,
        DnaRaceDocumentQuarantineOnlyOutcome
      >();

      for (
        let attempt = 1;
        attempt <= DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS;
        attempt += 1
      ) {
        const batchOutcomes = new Map<
          string,
          DnaRaceDocumentQuarantineHydrationOutcome
        >();

        try {
          const response = await raceDocsWithProviderRetry({
            batch,
            client: input.client,
            requestBudget: input.requestBudget,
            onRequest: () => {
              providerRequestCount += 1;
            },
          });
          if (!Array.isArray(response.result)) {
            stableBatchQuarantines.clear();
            hydrationError("invalid_response", "race-doc response is invalid");
          }
          if (batch.length > 1 && response.result.length === 0) {
            stableBatchQuarantines.clear();
            hydrationError(
              "invalid_response",
              "race-doc batch coverage is systemically unavailable",
            );
          }

          const returnedKeys = new Set<string>();
          for (const document of response.result) {
            const key = raceKey(document.rid);
            if (!batchKeySet.has(key)) {
              hydrationError(
                "unexpected_document",
                "race-doc response contains an unexpected Race",
              );
            }
            if (
              returnedKeys.has(key) ||
              batchOutcomes.has(key) ||
              outcomesByKey.has(key)
            ) {
              hydrationError(
                "duplicate_document",
                "race-doc response contains a duplicate Race",
              );
            }
            returnedKeys.add(key);

            let sourceEvidenceSha256: string | undefined;
            try {
              sourceEvidenceSha256 = dnaOpenLabRawEvidenceSha256(document);
            } catch {
              batchOutcomes.set(
                key,
                quarantined({
                  sourceRaceId: key,
                  observedAt: input.observedAt,
                  quarantineReason: "provider_document_unusable",
                }),
              );
              continue;
            }

            let evidence: DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>;
            try {
              evidence = adaptDnaRaceDocument({
                raw: document as DnaRaceDocument,
                observedAt: input.observedAt,
                endpoint: "races.docs",
              });
            } catch (error) {
              if (
                !(error instanceof DnaRaceDocumentAdaptationProcessingError)
              ) {
                throw error;
              }
              batchOutcomes.set(
                key,
                quarantined({
                  sourceRaceId: key,
                  observedAt: input.observedAt,
                  quarantineReason: "provider_document_unusable",
                  sourceEvidenceSha256,
                }),
              );
              continue;
            }

            if (
              evidence.canonical.sourceRaceId !== key ||
              evidence.entityKey !== `race:${key}`
            ) {
              hydrationError(
                "conflicting_document",
                "race-doc adapted identity conflicts with the requested Race",
              );
            }

            if (!resolvedEntrantAuthority(evidence.canonical)) {
              batchOutcomes.set(
                key,
                quarantined({
                  sourceRaceId: key,
                  observedAt: input.observedAt,
                  quarantineReason: "entrant_authority_unresolved",
                  sourceEvidenceSha256,
                }),
              );
              continue;
            }

            batchOutcomes.set(
              key,
              Object.freeze({
                status: "resolved" as const,
                sourceRaceId: key,
                evidence,
              }),
            );
          }

          for (const key of batchKeys) {
            if (!returnedKeys.has(key)) {
              batchOutcomes.set(
                key,
                quarantined({
                  sourceRaceId: key,
                  observedAt: input.observedAt,
                  quarantineReason: "provider_document_missing",
                }),
              );
            }
          }

          if (
            batchKeys.length > 1 &&
            batchKeys.every(
              (key) => batchOutcomes.get(key)?.status === "quarantined",
            )
          ) {
            for (const key of batchKeys) {
              const outcome = batchOutcomes.get(key);
              const hasRaceSpecificEvidence =
                outcome?.status === "quarantined" &&
                outcome.quarantineReason !== "provider_document_missing" &&
                outcome.sourceEvidenceSha256 !== undefined;
              if (!hasRaceSpecificEvidence) {
                stableBatchQuarantines.delete(key);
                continue;
              }

              if (attempt === 1) {
                stableBatchQuarantines.set(key, outcome);
                continue;
              }

              const previous = stableBatchQuarantines.get(key);
              if (
                previous === undefined ||
                previous.quarantineReason !== outcome.quarantineReason ||
                previous.sourceEvidenceSha256 !== outcome.sourceEvidenceSha256
              ) {
                stableBatchQuarantines.delete(key);
              }
            }
            hydrationError(
              "invalid_response",
              "race-doc batch entrant authority is systemically unavailable",
            );
          }

          for (const [key, outcome] of batchOutcomes) {
            outcomesByKey.set(key, outcome);
          }
          return;
        } catch (error) {
          const systemicInvalidResponse =
            error instanceof DnaRaceDocumentHydrationError &&
            error.kind === "invalid_response";
          if (
            systemicInvalidResponse &&
            attempt < DNA_RACE_DOCUMENT_SYSTEMIC_RESPONSE_MAX_ATTEMPTS
          ) {
            continue;
          }
          if (systemicInvalidResponse && batch.length > 1) {
            // Repeated identical Race-specific evidence already proves stable
            // quarantine authority. Avoid three redundant singleton probes for
            // those Races; only missing or unstable evidence is isolated.
            for (const [key, outcome] of stableBatchQuarantines) {
              if (outcomesByKey.has(key)) {
                hydrationError(
                  "duplicate_document",
                  "race-doc stable batch outcome duplicates prior authority",
                );
              }
              outcomesByKey.set(key, outcome);
            }

            for (const raceId of batch) {
              const key = raceKey(raceId);
              if (outcomesByKey.has(key)) continue;

              let accepted: DnaRaceDocumentQuarantineOutcome | undefined;
              let stableQuarantine:
                DnaRaceDocumentQuarantineOnlyOutcome | undefined;

              for (
                let probe = 1;
                probe <= DNA_RACE_DOCUMENT_SYSTEMIC_INDIVIDUAL_PROBE_ATTEMPTS;
                probe += 1
              ) {
                const isolated = await hydrateDnaRaceDocumentsWithQuarantine({
                  raceIds: [raceId],
                  client: input.client,
                  requestBudget: input.requestBudget,
                  observedAt: input.observedAt,
                });
                providerRequestCount += isolated.providerRequestCount;
                const outcome = isolated.outcomes[0];
                if (outcome === undefined) {
                  hydrationError(
                    "invalid_response",
                    "race-doc isolated outcome is unavailable",
                  );
                }
                if (outcome.status === "resolved") {
                  accepted = outcome;
                  break;
                }
                if (stableQuarantine === undefined) {
                  stableQuarantine = outcome;
                  continue;
                }
                if (
                  stableQuarantine.quarantineReason !==
                    outcome.quarantineReason ||
                  stableQuarantine.sourceEvidenceSha256 !==
                    outcome.sourceEvidenceSha256
                ) {
                  hydrationError(
                    "invalid_response",
                    "race-doc isolated quarantine evidence is unstable",
                  );
                }
              }

              const outcome = accepted ?? stableQuarantine;
              if (outcome === undefined) {
                hydrationError(
                  "invalid_response",
                  "race-doc isolated verification is unavailable",
                );
              }
              if (outcomesByKey.has(key)) {
                hydrationError(
                  "duplicate_document",
                  "race-doc isolated outcome duplicates prior authority",
                );
              }
              outcomesByKey.set(key, outcome);
            }
            return;
          }
          throw error;
        }
      }

      throw new Error("unreachable systemic-response retry state");
    },
  );

  const outcomes = Object.freeze(
    requestedKeys.map((key) => {
      const outcome = outcomesByKey.get(key);
      if (outcome === undefined) {
        return hydrationError(
          "missing_document",
          "race-doc outcome was not materialized",
        );
      }
      return outcome;
    }),
  );
  const resolvedRaceCount = outcomes.filter(
    (outcome) => outcome.status === "resolved",
  ).length;
  const quarantinedRaceCount = outcomes.length - resolvedRaceCount;

  return Object.freeze({
    outcomes,
    requestedRaceCount: requestedKeys.length,
    batchCount: requestBatches.length,
    providerRequestCount,
    resolvedRaceCount,
    quarantinedRaceCount,
  });
}
