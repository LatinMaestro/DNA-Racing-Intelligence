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
import type {
  DnaPopulationEntrantAuthorityQuarantineReason,
} from "./dna-population-entrant-authority-record";
import type {
  DnaOpenLabClient,
  DnaRaceDocument,
  DnaRaceIdentifier,
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

export type DnaRaceDocumentQuarantineHydrationResult = Readonly<{
  outcomes: readonly DnaRaceDocumentQuarantineHydrationOutcome[];
  requestedRaceCount: number;
  batchCount: number;
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
  const requestBatches = batches(
    input.raceIds,
    DNA_RACE_DOCUMENT_BATCH_LIMIT,
  );

  for (const batch of requestBatches) {
    const batchKeys = batch.map(raceKey);
    const batchKeySet = new Set(batchKeys);
    const response = await input.requestBudget.execute(() =>
      input.client.raceDocs(batch),
    );
    if (!Array.isArray(response.result)) {
      hydrationError("invalid_response", "race-doc response is invalid");
    }
    if (batch.length > 1 && response.result.length === 0) {
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
      if (returnedKeys.has(key) || outcomesByKey.has(key)) {
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
        outcomesByKey.set(
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
        if (!(error instanceof DnaRaceDocumentAdaptationProcessingError)) {
          throw error;
        }
        outcomesByKey.set(
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
        outcomesByKey.set(
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

      outcomesByKey.set(
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
        outcomesByKey.set(
          key,
          quarantined({
            sourceRaceId: key,
            observedAt: input.observedAt,
            quarantineReason: "provider_document_missing",
          }),
        );
      }
    }
  }

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
    resolvedRaceCount,
    quarantinedRaceCount,
  });
}
