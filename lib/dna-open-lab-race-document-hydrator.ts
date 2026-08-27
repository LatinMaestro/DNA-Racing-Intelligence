import {
  adaptDnaRaceDocument,
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentReference,
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
  documents: readonly DnaOpenLabEvidence<CanonicalRaceDocumentReference>[];
  requestedRaceCount: number;
  batchCount: number;
}>;

export class DnaRaceDocumentHydrationError extends Error {
  readonly kind:
    | "invalid_request"
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
  if (input.raceIds.length < 1) {
    hydrationError("invalid_request", "at least one race id is required");
  }

  const requestedKeys = input.raceIds.map((rid) => raceKey(rid));
  const uniqueRequestedKeys = new Set(requestedKeys);
  if (uniqueRequestedKeys.size !== requestedKeys.length) {
    hydrationError("invalid_request", "requested race ids must be unique");
  }

  const evidenceByKey = new Map<
    string,
    Readonly<{
      hash: string;
      evidence: DnaOpenLabEvidence<CanonicalRaceDocumentReference>;
    }>
  >();
  const requestBatches = batches(input.raceIds, DNA_RACE_DOCUMENT_BATCH_LIMIT);

  for (const batch of requestBatches) {
    const batchKeys = new Set(batch.map((rid) => raceKey(rid)));
    const response = await input.requestBudget.execute(() =>
      input.client.raceDocs(batch),
    );

    const returnedKeys = new Set<string>();
    for (const document of response.result) {
      const key = raceKey(document.rid);
      if (!batchKeys.has(key)) {
        hydrationError(
          "unexpected_document",
          `DNA race-doc hydration returned unexpected race ${key}`,
        );
      }

      const hash = dnaOpenLabRawEvidenceSha256(document);
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
      evidenceByKey.set(
        key,
        Object.freeze({
          hash,
          evidence: adaptDnaRaceDocument({
            raw: document as DnaRaceDocument,
            observedAt: input.observedAt,
            endpoint: "races.docs",
          }),
        }),
      );
    }

    for (const key of batchKeys) {
      if (!returnedKeys.has(key)) {
        hydrationError(
          "missing_document",
          `DNA race-doc hydration did not return requested race ${key}`,
        );
      }
    }
  }

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
}
