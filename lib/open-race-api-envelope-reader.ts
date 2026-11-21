import { scanOwnerVaultOpenRaceOpportunities } from "@/domain/open-race-owner-vault-scanner";
import type { DnaCurrentRaceMaterializationRow } from "@/lib/dna-open-lab-current-race-materialization";
import {
  adaptDnaActiveRace,
  adaptDnaRaceDocument,
  adaptDnaRaceFill,
  adaptDnaVaultCore,
  dnaActiveRaceSourceId,
  type CanonicalActiveRaceSnapshot,
  type CanonicalRaceDocumentMetadata,
  type CanonicalRaceFillSnapshot,
} from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaActiveRace,
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaRaceDocument,
  DnaRaceFill,
  DnaRaceIdentifier,
} from "@/lib/dna-open-lab-v1-client";
import type { DnaOpenLabServingOwnedCore } from "@/lib/neon-dna-open-lab-sync-publication";

const GENERATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RACE_BATCH_SIZE = 20;

type OpenRaceReadClient = Pick<
  DnaOpenLabClient,
  "vaultCoresFull" | "racesActive" | "raceFills" | "raceDocs"
>;

export type OpenRaceApiEnvelopeReadOutcome =
  | Readonly<{
      status: "ready";
      sourceStatus: "live_api" | "offline_replay";
      requestCount: number;
      activeRaceCount: number;
      detailRaceCount: number;
      prefilteredRaceCount: number;
      ownedCoreCount: number;
      envelope: Parameters<typeof scanOwnerVaultOpenRaceOpportunities>[0];
      gameEntryAllowed: false;
    }>
  | Readonly<{
      status: "unavailable";
      sourceStatus: "live_api" | "offline_replay";
      reason:
        | "source_unavailable"
        | "request_budget_exceeded"
        | "provider_budget_unavailable"
        | "active_race_limit_exceeded"
        | "incomplete_race_coverage";
      requestCount: number;
      envelope: null;
      gameEntryAllowed: false;
    }>;

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("Open Race API envelope observation time is invalid.");
  }
  return value;
}

function row<T>(
  input: Readonly<{
    sourceRaceId: string;
    observedAt: string;
    rawEvidenceSha256: string;
    canonical: T;
  }>,
): DnaCurrentRaceMaterializationRow<T> {
  return Object.freeze({ ...input });
}

function successful<T>(response: DnaOpenLabResponse<T>): boolean {
  return response.httpStatus >= 200 && response.httpStatus < 300;
}

function providerAllows(
  response: DnaOpenLabResponse<unknown>,
  plannedRequests: number,
): boolean {
  return (
    (response.rateLimit.retryAfterSeconds === null ||
      response.rateLimit.retryAfterSeconds === 0) &&
    (response.rateLimit.remaining === null ||
      response.rateLimit.remaining >= plannedRequests)
  );
}

function batches<T>(values: readonly T[]): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += RACE_BATCH_SIZE) {
    result.push(values.slice(index, index + RACE_BATCH_SIZE));
  }
  return result;
}

function needsOrdinaryOpenRaceDetail(race: DnaActiveRace): boolean {
  const status = race.status.trim().toLowerCase();
  if (status !== "open" && status !== "filling") return false;
  if (
    !Number.isSafeInteger(race.rgate) ||
    race.rgate < 2 ||
    !Number.isSafeInteger(race.hs_in) ||
    race.hs_in < 0 ||
    race.hs_in > race.rgate
  ) {
    throw new Error("Open Race active inventory gate evidence is invalid.");
  }
  return race.hs_in >= Math.ceil(race.rgate / 2) && race.hs_in < race.rgate;
}

function sameValues(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => sortedRight[index] === value)
  );
}

/**
 * Reads only documented Open Lab discovery endpoints and produces the exact
 * canonical input accepted by the ordinary Open Race scanner. It never calls
 * a mutation or entry endpoint, never stores credentials, and fails closed on
 * request-budget, active-race or exact field-coverage drift.
 */
export async function readOpenRaceApiEnvelope(
  input: Readonly<{
    client: OpenRaceReadClient;
    sourceStatus: "live_api" | "offline_replay";
    vault: string;
    generationId: string;
    observedAt: string;
    maximumAgeMinutes: number;
    maximumActiveRaces: number;
    maximumRequests: number;
  }>,
): Promise<OpenRaceApiEnvelopeReadOutcome> {
  const observedAt = timestamp(input.observedAt);
  const vault = input.vault.trim();
  if (
    vault.length < 1 ||
    vault.length > 256 ||
    !GENERATION_ID.test(input.generationId) ||
    !Number.isSafeInteger(input.maximumAgeMinutes) ||
    input.maximumAgeMinutes < 1 ||
    input.maximumAgeMinutes > 60 ||
    !Number.isSafeInteger(input.maximumActiveRaces) ||
    input.maximumActiveRaces < 1 ||
    input.maximumActiveRaces > 100 ||
    !Number.isSafeInteger(input.maximumRequests) ||
    input.maximumRequests < 2 ||
    input.maximumRequests > 12
  ) {
    throw new Error("Open Race API envelope limits are invalid.");
  }

  let requestCount = 0;
  const unavailable = (
    reason: Extract<
      OpenRaceApiEnvelopeReadOutcome,
      { status: "unavailable" }
    >["reason"],
  ): OpenRaceApiEnvelopeReadOutcome => ({
    status: "unavailable",
    sourceStatus: input.sourceStatus,
    reason,
    requestCount,
    envelope: null,
    gameEntryAllowed: false,
  });

  try {
    requestCount += 1;
    const vaultResponse = await input.client.vaultCoresFull(vault);
    requestCount += 1;
    const activeResponse = await input.client.racesActive();
    if (!successful(vaultResponse) || !successful(activeResponse)) {
      return unavailable("source_unavailable");
    }
    if (activeResponse.result.length > input.maximumActiveRaces) {
      return unavailable("active_race_limit_exceeded");
    }

    // The ordinary advisory gate rule is an inventory prefilter only. Paid
    // tournament qualification does not call this reader and must not inherit
    // the half-filled condition. Detail reads are therefore reserved for open,
    // vacant ordinary races that already meet the documented threshold.
    const detailRaces = activeResponse.result.filter(
      needsOrdinaryOpenRaceDetail,
    );
    const raceBatches = batches(detailRaces);
    const requiredRequests = requestCount + raceBatches.length * 2;
    if (requiredRequests > input.maximumRequests) {
      return unavailable("request_budget_exceeded");
    }
    const plannedDetailRequests = raceBatches.length * 2;
    if (
      !providerAllows(vaultResponse, plannedDetailRequests) ||
      !providerAllows(activeResponse, plannedDetailRequests)
    ) {
      return unavailable("provider_budget_unavailable");
    }

    const rawFills: DnaRaceFill[] = [];
    const rawDocuments: DnaRaceDocument[] = [];
    for (const [batchIndex, batch] of raceBatches.entries()) {
      const raceIds: readonly DnaRaceIdentifier[] = batch.map(({ rid }) => rid);
      requestCount += 1;
      const fills = await input.client.raceFills(raceIds);
      if (!successful(fills)) {
        return unavailable("source_unavailable");
      }
      const callsAfterFills = 1 + (raceBatches.length - batchIndex - 1) * 2;
      if (!providerAllows(fills, callsAfterFills)) {
        return unavailable("provider_budget_unavailable");
      }
      requestCount += 1;
      const documents = await input.client.raceDocs(raceIds);
      if (!successful(documents)) {
        return unavailable("source_unavailable");
      }
      const callsAfterDocuments = (raceBatches.length - batchIndex - 1) * 2;
      if (!providerAllows(documents, callsAfterDocuments)) {
        return unavailable("provider_budget_unavailable");
      }
      rawFills.push(...fills.result);
      rawDocuments.push(...documents.result);
    }

    const activeEvidence = detailRaces.map((raw) =>
      adaptDnaActiveRace({ raw, observedAt }),
    );
    const fillEvidence = rawFills.map((raw) =>
      adaptDnaRaceFill({ raw, observedAt }),
    );
    const documentEvidence = rawDocuments.map((raw) =>
      adaptDnaRaceDocument({ raw, observedAt, endpoint: "races.docs" }),
    );
    const activeIds = detailRaces.map(dnaActiveRaceSourceId);
    if (
      new Set(activeIds).size !== activeIds.length ||
      !sameValues(
        activeIds,
        fillEvidence.map(({ canonical }) => canonical.sourceRaceId),
      ) ||
      !sameValues(
        activeIds,
        documentEvidence.map(({ canonical }) => canonical.sourceRaceId),
      )
    ) {
      return unavailable("incomplete_race_coverage");
    }

    const ownedCores: readonly DnaOpenLabServingOwnedCore[] =
      vaultResponse.result.map((raw) => {
        const evidence = adaptDnaVaultCore({ raw, observedAt });
        return Object.freeze({
          generationId: input.generationId,
          observedAt,
          rawEvidenceSha256: evidence.rawEvidenceSha256,
          canonical: evidence.canonical,
        });
      });
    const activeRaces: readonly DnaCurrentRaceMaterializationRow<CanonicalActiveRaceSnapshot>[] =
      activeEvidence.map((evidence) =>
        row({
          sourceRaceId: evidence.canonical.sourceRaceId,
          observedAt,
          rawEvidenceSha256: evidence.rawEvidenceSha256,
          canonical: evidence.canonical,
        }),
      );
    const raceFills: readonly DnaCurrentRaceMaterializationRow<CanonicalRaceFillSnapshot>[] =
      fillEvidence.map((evidence) =>
        row({
          sourceRaceId: evidence.canonical.sourceRaceId,
          observedAt,
          rawEvidenceSha256: evidence.rawEvidenceSha256,
          canonical: evidence.canonical,
        }),
      );
    const documents: readonly DnaCurrentRaceMaterializationRow<CanonicalRaceDocumentMetadata>[] =
      documentEvidence.map((evidence) =>
        row({
          sourceRaceId: evidence.canonical.sourceRaceId,
          observedAt,
          rawEvidenceSha256: evidence.rawEvidenceSha256,
          canonical: evidence.canonical,
        }),
      );

    return {
      status: "ready",
      sourceStatus: input.sourceStatus,
      requestCount,
      activeRaceCount: activeResponse.result.length,
      detailRaceCount: activeRaces.length,
      prefilteredRaceCount: activeResponse.result.length - activeRaces.length,
      ownedCoreCount: ownedCores.length,
      envelope: {
        evaluatedAt: observedAt,
        maximumAgeMinutes: input.maximumAgeMinutes,
        ownedCores,
        currentRaces: {
          generationId: input.generationId,
          activeRaces,
          raceFills,
        },
        documents,
      },
      gameEntryAllowed: false,
    };
  } catch {
    return unavailable("source_unavailable");
  }
}
