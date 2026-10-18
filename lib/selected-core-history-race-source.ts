import { raceModes } from "@/domain/core-performance";
import type { ActiveCoreHistoryCanonicalRaceAuthority } from "@/lib/active-core-history-pro-league-source";
import {
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";
import type {
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  SelectedDnaCoreRaceHistoryReadRepository,
} from "@/lib/neon-active-dna-core-race-history-generation";

type Selection = Parameters<
  SelectedDnaCoreRaceHistoryReadRepository["readSelectedCoreRows"]
>[1];
type RaceReference = Parameters<
  ActiveCoreHistoryCanonicalRaceAuthority["readRaceDocuments"]
>[1][number];

export type SelectedCoreHistoryRaceObservation = Readonly<{
  coreId: string;
  eventId: string;
  eventAt: string;
  elapsedTimeMilliseconds: number;
  mode: (typeof raceModes)[number];
  distanceMeters: number;
  gateCount: number;
  format: string;
  raceDocumentEvidenceSha256: string;
  raceDocumentObservedAt: string;
  // Neither absent tags nor a current Core's element proves historical context.
  competition: "unknown";
  element: Readonly<{ status: "unknown"; value: null }>;
}>;

export type SelectedCoreHistoryRaceSource = Readonly<{
  status:
    | "ready"
    | "source_unavailable"
    | "source_changed"
    | "truncated"
    | "document_budget_exceeded";
  observations: readonly SelectedCoreHistoryRaceObservation[];
  selectedOutcomeCount: number;
  generationId: string | null;
  observationSetSha256: string | null;
  evidenceCutoff: string | null;
  analyticalUseAllowed: false;
  exactContextVerified: false;
}>;

const ERROR = "Selected Core canonical Race evidence is unavailable.";
const SHA_256 = /^[a-f0-9]{64}$/u;

function fail(): never {
  throw new Error(ERROR);
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  )
    fail();
  return value;
}

function timestamp(value: unknown): string {
  const supplied = text(value);
  const date = new Date(supplied);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== supplied) fail();
  return supplied;
}

function result(
  status: SelectedCoreHistoryRaceSource["status"],
  observations: readonly SelectedCoreHistoryRaceObservation[] = [],
  selectedOutcomeCount = 0,
  source?: Readonly<{
    generationId: string;
    observationSetSha256: string;
    evidenceCutoff: string;
  }>,
): SelectedCoreHistoryRaceSource {
  return Object.freeze({
    status,
    observations: Object.freeze([...observations]),
    selectedOutcomeCount,
    generationId: source?.generationId ?? null,
    observationSetSha256: source?.observationSetSha256 ?? null,
    evidenceCutoff: source?.evidenceCutoff ?? null,
    analyticalUseAllowed: false,
    exactContextVerified: false,
  });
}

/**
 * Read-only composition over existing owner-scoped stores. Call only inside the
 * provider/cost clearance boundary; this function creates no provider client.
 * A successful join proves observable Race facts, never historical population
 * completeness, competition/element authority or permission to issue predictions.
 */
export async function readSelectedCoreHistoryRaceSource(
  input: Readonly<{
    authenticatedOwnerId: string;
    configuredOwnerId: string;
    selection: Selection;
    evidenceCutoff: string;
    maximumRaceDocuments: number;
    repository: Pick<
      ActiveDnaCoreRaceHistoryGenerationReadRepository,
      "readActiveGeneration"
    > &
      SelectedDnaCoreRaceHistoryReadRepository;
    raceAuthority: ActiveCoreHistoryCanonicalRaceAuthority;
  }>,
): Promise<SelectedCoreHistoryRaceSource> {
  try {
    const ownerId = text(input.authenticatedOwnerId);
    if (ownerId !== text(input.configuredOwnerId)) fail();
    const cutoff = timestamp(input.evidenceCutoff);
    const selection = input.selection;
    if (
      !SHA_256.test(selection.generationId) ||
      !SHA_256.test(selection.observationSetSha256) ||
      !Array.isArray(selection.coreIds) ||
      selection.coreIds.length < 1 ||
      selection.coreIds.length > 64 ||
      new Set(selection.coreIds).size !== selection.coreIds.length ||
      !Number.isSafeInteger(selection.maximumRows) ||
      selection.maximumRows < 1 ||
      selection.maximumRows > 10_000 ||
      !Number.isSafeInteger(input.maximumRaceDocuments) ||
      input.maximumRaceDocuments < 1 ||
      input.maximumRaceDocuments > 10_000
    )
      fail();
    const pinned = Object.freeze({
      ...selection,
      coreIds: Object.freeze(selection.coreIds.map(text)),
    });
    const generation = await input.repository.readActiveGeneration(ownerId);
    if (generation === null) return result("source_unavailable");
    if (
      generation.generationId !== pinned.generationId ||
      generation.observationSetSha256 !== pinned.observationSetSha256
    )
      return result("source_changed");
    const selected = await input.repository.readSelectedCoreRows(
      ownerId,
      pinned,
    );
    if (selected.status !== "ready") return result(selected.status);
    if (selected.rows.length > pinned.maximumRows) fail();

    const references = new Map<string, RaceReference>();
    const seen = new Set<string>();
    for (const row of selected.rows) {
      const value = row.payload;
      if (
        row.generationId !== pinned.generationId ||
        value.sourceType !== "core_race_history_outcome" ||
        !pinned.coreIds.includes(value.sourceCoreId) ||
        seen.has(row.naturalKey) ||
        row.naturalKey !==
          `core-result:${value.sourceCoreId}:${value.sourceRaceId}` ||
        value.naturalKey !== row.naturalKey ||
        dnaOpenLabRawEvidenceSha256(value) !== row.rowSha256 ||
        !SHA_256.test(value.raceDocumentEvidenceSha256) ||
        !Number.isSafeInteger(value.elapsedMilliseconds) ||
        value.elapsedMilliseconds <= 0 ||
        !Number.isSafeInteger(value.finishPosition) ||
        value.finishPosition <= 0
      )
        fail();
      seen.add(row.naturalKey);
      const reference = Object.freeze({
        sourceRaceId: text(value.sourceRaceId),
        observedAt: timestamp(value.raceDocumentObservedAt),
        rawEvidenceSha256: value.raceDocumentEvidenceSha256,
      });
      const previous = references.get(reference.sourceRaceId);
      if (
        previous !== undefined &&
        (previous.observedAt !== reference.observedAt ||
          previous.rawEvidenceSha256 !== reference.rawEvidenceSha256)
      )
        fail();
      references.set(reference.sourceRaceId, reference);
    }
    if (references.size > input.maximumRaceDocuments)
      return result("document_budget_exceeded");

    const documents = new Map<
      string,
      DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>
    >();
    const requested = [...references.values()];
    // Sequential bounded batches; never fan out all requested private objects.
    for (let offset = 0; offset < requested.length; offset += 20) {
      const batch = requested.slice(offset, offset + 20);
      const loaded = await input.raceAuthority.readRaceDocuments(
        ownerId,
        batch,
      );
      if (loaded.length !== batch.length) fail();
      for (const document of loaded) {
        const raceId = document.canonical.sourceRaceId;
        const reference = batch.find((entry) => entry.sourceRaceId === raceId);
        if (
          reference === undefined ||
          documents.has(raceId) ||
          document.source !== "dna_open_lab" ||
          document.sourceVersion !== "v1" ||
          document.scope !== "races" ||
          document.endpoint !== "races.docs" ||
          document.entityKey !== `race:${raceId}` ||
          document.observedAt !== reference.observedAt ||
          document.rawEvidenceSha256 !== reference.rawEvidenceSha256 ||
          document.canonical.sourceType !== "race_document"
        )
          fail();
        documents.set(raceId, document);
      }
    }
    const observations = selected.rows.flatMap(
      (row): SelectedCoreHistoryRaceObservation[] => {
        const value = row.payload;
        if (value.sourceType !== "core_race_history_outcome") return fail();
        const race = documents.get(value.sourceRaceId)?.canonical;
        if (
          race === undefined ||
          race.mode === undefined ||
          !raceModes.includes(race.mode) ||
          !Number.isSafeInteger(race.distanceMetres) ||
          race.distanceMetres! <= 0 ||
          !Number.isSafeInteger(race.gateCount) ||
          race.gateCount! <= 0 ||
          !Array.isArray(race.entrantCoreIds) ||
          new Set(race.entrantCoreIds).size !== race.entrantCoreIds.length ||
          !race.entrantCoreIds.includes(value.sourceCoreId) ||
          value.finishPosition > race.gateCount! ||
          race.modeEvidenceStatus !== undefined ||
          race.distanceEvidenceStatus !== undefined ||
          race.formatEvidenceStatus !== undefined ||
          race.entrantCoreIdsEvidenceStatus !== undefined
        )
          fail();
        const eventAt = timestamp(race.startAt);
        const format = text(race.format);
        // Event cutoff is strict; a result at/after it cannot enter prior evidence.
        if (eventAt >= cutoff) return [];
        return [
          Object.freeze({
            coreId: value.sourceCoreId,
            eventId: value.sourceRaceId,
            eventAt,
            elapsedTimeMilliseconds: value.elapsedMilliseconds,
            mode: race.mode,
            distanceMeters: race.distanceMetres!,
            gateCount: race.gateCount!,
            format,
            raceDocumentEvidenceSha256: value.raceDocumentEvidenceSha256,
            raceDocumentObservedAt: value.raceDocumentObservedAt,
            competition: "unknown" as const,
            element: Object.freeze({ status: "unknown" as const, value: null }),
          }),
        ];
      },
    );
    const confirmed = await input.repository.readActiveGeneration(ownerId);
    if (
      confirmed === null ||
      dnaOpenLabRawEvidenceSha256(generation) !==
        dnaOpenLabRawEvidenceSha256(confirmed)
    )
      return result("source_changed");
    return result("ready", observations, selected.rows.length, {
      generationId: pinned.generationId,
      observationSetSha256: pinned.observationSetSha256,
      evidenceCutoff: cutoff,
    });
  } catch {
    return fail();
  }
}
