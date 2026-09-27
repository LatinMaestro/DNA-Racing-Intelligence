import type {
  ActiveCoreHistoryCanonicalRaceAuthority,
  ActiveCoreHistoryCanonicalRaceDocument,
} from "./active-core-history-pro-league-source";
import type {
  DnaPopulationEntrantAuthorityLiveAudit,
  DnaPopulationEntrantAuthorityLiveAuditSource,
} from "./dna-population-entrant-authority-cohort-command";

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAXIMUM_RACE_IDS_PER_READ = 250;

function authorityError(message: string): never {
  throw new Error(`Active Core history durable Race authority: ${message}`);
}

function identity(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    return authorityError(`${field} is invalid`);
  }
  return value;
}

function exactHead(value: string): string {
  const normalized = identity(value, "exactCodeHeadSha").toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    return authorityError("exactCodeHeadSha is invalid");
  }
  return normalized;
}

function validateAudit(
  audit: DnaPopulationEntrantAuthorityLiveAudit,
  expectedHead: string,
): ReadonlyMap<string, ActiveCoreHistoryCanonicalRaceDocument> {
  if (
    audit.exactCodeHeadSha !== expectedHead ||
    audit.raceDocumentEvidence === undefined ||
    audit.raceDocumentEvidence.length !== audit.raceDocuments.length ||
    audit.raceDocumentEvidence.length < 1
  ) {
    return authorityError("exact durable Race snapshot is unavailable");
  }
  const documents = new Map<string, ActiveCoreHistoryCanonicalRaceDocument>();
  for (const evidence of audit.raceDocumentEvidence) {
    const sourceRaceId = identity(
      evidence.canonical.sourceRaceId,
      "sourceRaceId",
    );
    if (
      evidence.canonical.sourceType !== "race_document" ||
      !/^[a-f0-9]{64}$/u.test(evidence.rawEvidenceSha256) ||
      documents.has(sourceRaceId)
    ) {
      return authorityError("durable Race snapshot is ambiguous");
    }
    documents.set(
      sourceRaceId,
      Object.freeze({
        canonical: evidence.canonical,
        rawEvidenceSha256: evidence.rawEvidenceSha256,
      }),
    );
  }
  if (documents.size !== audit.raceDocuments.length) {
    return authorityError("durable Race snapshot coverage is inconsistent");
  }
  return documents;
}

/**
 * Adapts the exact-main, read-only combined Race audit into the normalized
 * Core-outcome analytical reader. The audit is loaded once and cached so every
 * page in one analytical publication observes one immutable Race snapshot.
 */
export function createActiveCoreHistoryDurableRaceAuthority(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  source: DnaPopulationEntrantAuthorityLiveAuditSource;
}): ActiveCoreHistoryCanonicalRaceAuthority {
  const ownerId = identity(input.ownerId, "ownerId");
  const expectedHead = exactHead(input.exactCodeHeadSha);
  let snapshot:
    | Promise<ReadonlyMap<string, ActiveCoreHistoryCanonicalRaceDocument>>
    | null = null;

  async function loadSnapshot() {
    snapshot ??= input.source
      .load({ ownerId, exactCodeHeadSha: expectedHead })
      .then((audit) => validateAudit(audit, expectedHead));
    return snapshot;
  }

  return Object.freeze({
    async readRaceDocuments(requestOwnerId, sourceRaceIds) {
      if (identity(requestOwnerId, "ownerId") !== ownerId) {
        return authorityError("owner scope changed");
      }
      if (
        sourceRaceIds.length < 1 ||
        sourceRaceIds.length > MAXIMUM_RACE_IDS_PER_READ
      ) {
        return authorityError("Race read bounds are invalid");
      }
      const requested = sourceRaceIds.map((value) =>
        identity(value, "sourceRaceId"),
      );
      if (new Set(requested).size !== requested.length) {
        return authorityError("Race read contains duplicate identities");
      }
      const documents = await loadSnapshot();
      return Object.freeze(
        requested.map((sourceRaceId) => {
          const document = documents.get(sourceRaceId);
          if (document === undefined) {
            return authorityError("requested Race evidence is unavailable");
          }
          return document;
        }),
      );
    },
  });
}
