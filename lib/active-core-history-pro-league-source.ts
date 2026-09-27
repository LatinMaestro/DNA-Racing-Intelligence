import { createHash } from "node:crypto";

import type { DnaCoreRaceHistoryPublishedGeneration } from "@/lib/dna-core-race-history-generation";
import {
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";
import type {
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  ActiveDnaCoreRaceHistoryGenerationRow,
} from "@/lib/neon-active-dna-core-race-history-generation";
import type { ProLeagueExactFormatAnalyticalObservation } from "@/lib/race-archive-spillable-pro-league-exact-format";

export type ActiveCoreHistoryProLeagueSource = Readonly<{
  generation: DnaCoreRaceHistoryPublishedGeneration;
  observations: AsyncIterable<ProLeagueExactFormatAnalyticalObservation>;
}>;

export type ActiveCoreHistoryCanonicalRaceAuthority = Readonly<{
  readRaceDocuments(
    ownerId: string,
    sourceRaceIds: readonly string[],
  ): Promise<readonly DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>[]>;
}>;

function observation(
  row: ActiveDnaCoreRaceHistoryGenerationRow,
  raceDocument?: DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>,
): ProLeagueExactFormatAnalyticalObservation {
  const value = row.payload;
  if (value.sourceType === "core_race_history_outcome") {
    const race = raceDocument?.canonical;
    const eventAt = race?.startAt;
    if (
      raceDocument === undefined ||
      race === undefined ||
      race.sourceType !== "race_document" ||
      race.sourceRaceId !== value.sourceRaceId ||
      raceDocument.rawEvidenceSha256 !== value.raceDocumentEvidenceSha256 ||
      race.entrantCoreIds === undefined ||
      !race.entrantCoreIds.includes(value.sourceCoreId) ||
      race.mode === undefined ||
      race.distanceMetres === undefined ||
      race.gateCount === undefined ||
      typeof eventAt !== "string" ||
      Number.isNaN(Date.parse(eventAt)) ||
      !Number.isSafeInteger(race.distanceMetres) ||
      race.distanceMetres < 1 ||
      !Number.isSafeInteger(race.gateCount) ||
      race.gateCount < 1 ||
      value.finishPosition > race.gateCount
    ) {
      throw new Error(
        "Active Core history canonical Race authority is invalid",
      );
    }
    return Object.freeze({
      naturalKey: value.naturalKey,
      sourceCoreId: value.sourceCoreId,
      eventAt: new Date(eventAt).toISOString(),
      mode: race.mode,
      distanceMetres: race.distanceMetres,
      gateCount: race.gateCount,
      finishPosition: value.finishPosition,
      elapsedMilliseconds: value.elapsedMilliseconds,
      payoutMechanismSourceValue: race.payoutSourceValue ?? null,
    });
  }
  if (
    typeof value.naturalKey !== "string" ||
    typeof value.sourceCoreId !== "string" ||
    typeof value.eventAt !== "string" ||
    (value.payoutMechanismSourceValue !== null &&
      typeof value.payoutMechanismSourceValue !== "string") ||
    value.distanceAuthority !== "result_and_race_document" ||
    !Number.isSafeInteger(value.distanceMetres) ||
    value.distanceMetres < 1 ||
    !Number.isSafeInteger(value.elapsedMilliseconds) ||
    value.elapsedMilliseconds < 1 ||
    !Number.isSafeInteger(value.finishPosition) ||
    value.finishPosition < 1 ||
    !Number.isSafeInteger(value.gateCount) ||
    value.gateCount < 1 ||
    value.finishPosition > value.gateCount ||
    Number.isNaN(Date.parse(value.eventAt))
  ) {
    throw new Error("Active Core history Pro League observation is invalid");
  }
  return Object.freeze({
    naturalKey: value.naturalKey,
    sourceCoreId: value.sourceCoreId,
    eventAt: new Date(value.eventAt).toISOString(),
    mode: value.mode,
    distanceMetres: value.distanceMetres,
    gateCount: value.gateCount,
    finishPosition: value.finishPosition,
    elapsedMilliseconds: value.elapsedMilliseconds,
    payoutMechanismSourceValue: value.payoutMechanismSourceValue,
  });
}

function sameGeneration(
  left: DnaCoreRaceHistoryPublishedGeneration,
  right: DnaCoreRaceHistoryPublishedGeneration | null,
): boolean {
  return (
    right !== null &&
    dnaOpenLabRawEvidenceSha256(left) === dnaOpenLabRawEvidenceSha256(right)
  );
}

export async function activeCoreHistoryProLeagueSource(input: {
  ownerId: string;
  repository: ActiveDnaCoreRaceHistoryGenerationReadRepository;
  raceAuthority?: ActiveCoreHistoryCanonicalRaceAuthority;
  pageSize?: number;
}): Promise<ActiveCoreHistoryProLeagueSource | null> {
  const generation = await input.repository.readActiveGeneration(input.ownerId);
  if (generation === null) return null;
  const pageSize = input.pageSize ?? 250;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 250) {
    throw new Error("Active Core history Pro League page size is invalid");
  }

  const observations = (async function* () {
    const digest = createHash("sha256");
    let afterOrdinal = -1;
    let count = 0;
    let previousNaturalKey: string | null = null;
    while (count < generation.observationCount) {
      const page = await input.repository.readActiveRows(
        input.ownerId,
        afterOrdinal,
        pageSize,
      );
      if (page.length === 0) {
        throw new Error(
          "Active Core history Pro League coverage is incomplete",
        );
      }
      const compactRows = page.filter(
        (row) => row.payload.sourceType === "core_race_history_outcome",
      );
      const raceDocuments = new Map<
        string,
        DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>
      >();
      if (compactRows.length > 0) {
        if (input.raceAuthority === undefined) {
          throw new Error(
            "Active Core history canonical Race authority is unavailable",
          );
        }
        const sourceRaceIds = [
          ...new Set(compactRows.map((row) => row.payload.sourceRaceId)),
        ];
        const loaded = await input.raceAuthority.readRaceDocuments(
          input.ownerId,
          Object.freeze(sourceRaceIds),
        );
        for (const document of loaded) {
          const sourceRaceId = document.canonical.sourceRaceId;
          if (
            !sourceRaceIds.includes(sourceRaceId) ||
            raceDocuments.has(sourceRaceId)
          ) {
            throw new Error(
              "Active Core history canonical Race authority is ambiguous",
            );
          }
          raceDocuments.set(sourceRaceId, document);
        }
        if (raceDocuments.size !== sourceRaceIds.length) {
          throw new Error(
            "Active Core history canonical Race coverage is incomplete",
          );
        }
      }
      for (const row of page) {
        if (
          row.generationId !== generation.generationId ||
          row.ordinal !== count ||
          (previousNaturalKey !== null &&
            previousNaturalKey.localeCompare(row.naturalKey) >= 0)
        ) {
          throw new Error("Active Core history Pro League order drifted");
        }
        digest.update(
          `${row.ordinal}:${row.naturalKey}:${row.rowSha256}\n`,
          "utf8",
        );
        previousNaturalKey = row.naturalKey;
        afterOrdinal = row.ordinal;
        count += 1;
        if (count > generation.observationCount) {
          throw new Error("Active Core history Pro League coverage exceeded");
        }
        yield observation(row, raceDocuments.get(row.payload.sourceRaceId));
      }
    }
    if (digest.digest("hex") !== generation.payloadSha256) {
      throw new Error("Active Core history Pro League digest changed");
    }
    const confirmed = await input.repository.readActiveGeneration(
      input.ownerId,
    );
    if (!sameGeneration(generation, confirmed)) {
      throw new Error("Active Core history Pro League pointer changed");
    }
  })();

  return Object.freeze({ generation, observations });
}
