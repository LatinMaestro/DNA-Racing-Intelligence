import { createHash } from "node:crypto";

import {
  DNA_FINISHED_RACE_WINDOW_LIMIT,
  type DnaFinishedRaceWindow,
} from "./dna-open-lab-finished-race-window-crawler";
import {
  hydrateDnaRaceDocuments,
  type DnaRaceDocumentHydrationResult,
} from "./dna-open-lab-race-document-hydrator";
import {
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

export const DNA_FINISHED_RACE_BACKFILL_CHECKPOINT_VERSION = 1 as const;
export const DNA_FINISHED_RACE_BACKFILL_MAX_PENDING_WINDOWS = 128 as const;

export type DnaFinishedRaceBackfillCheckpoint = Readonly<{
  version: typeof DNA_FINISHED_RACE_BACKFILL_CHECKPOINT_VERSION;
  rootWindow: DnaFinishedRaceWindow;
  pendingWindows: readonly DnaFinishedRaceWindow[];
  minimumWindowMilliseconds: number;
  completedWindowCount: number;
  splitCount: number;
  successfulFinishedRaceRequestCount: number;
  raceDocumentRequestCount: number;
  publishedWindowDocumentCount: number;
}>;

export type StoredDnaFinishedRaceBackfillCheckpoint = Readonly<{
  revision: string;
  checkpoint: DnaFinishedRaceBackfillCheckpoint;
}>;

/**
 * `save(null, checkpoint)` means create-if-absent. A non-null expected revision
 * means compare-and-swap. Provider adapters must fail closed on revision drift.
 */
export type DnaFinishedRaceBackfillCheckpointRepository = Readonly<{
  load: () => Promise<StoredDnaFinishedRaceBackfillCheckpoint | null>;
  save: (input: {
    expectedRevision: string | null;
    checkpoint: DnaFinishedRaceBackfillCheckpoint;
  }) => Promise<StoredDnaFinishedRaceBackfillCheckpoint>;
}>;

export type DnaFinishedRaceWindowPublication = Readonly<{
  windowKey: string;
  contentSha256: string;
  window: DnaFinishedRaceWindow;
  discoveredRaces: readonly DnaRaceDocument[];
  hydratedDocuments: readonly DnaOpenLabEvidence<CanonicalRaceDocumentReference>[];
}>;

export type DnaFinishedRaceWindowPublicationReceipt = Readonly<{
  windowKey: string;
  contentSha256: string;
  documentCount: number;
}>;

/**
 * Publisher implementations must be idempotent by `windowKey` and must reject
 * conflicting content for an already-published key. This lets a process safely
 * replay a publication after a crash that occurred before checkpoint advancement.
 */
export type DnaFinishedRaceWindowPublisher = (
  publication: DnaFinishedRaceWindowPublication,
) => Promise<DnaFinishedRaceWindowPublicationReceipt>;

export type DnaFinishedRaceBackfillStepResult =
  | Readonly<{
      kind: "complete";
      stored: StoredDnaFinishedRaceBackfillCheckpoint;
    }>
  | Readonly<{
      kind: "split";
      parentWindow: DnaFinishedRaceWindow;
      childWindows: readonly [DnaFinishedRaceWindow, DnaFinishedRaceWindow];
      stored: StoredDnaFinishedRaceBackfillCheckpoint;
    }>
  | Readonly<{
      kind: "published";
      window: DnaFinishedRaceWindow;
      publicationReceipt: DnaFinishedRaceWindowPublicationReceipt;
      stored: StoredDnaFinishedRaceBackfillCheckpoint;
    }>;

export class DnaFinishedRaceBackfillError extends Error {
  readonly kind:
    | "invalid_configuration"
    | "invalid_checkpoint"
    | "source_limit_breach"
    | "unprovable_saturation"
    | "duplicate_race"
    | "publication_mismatch";

  constructor(input: {
    kind: DnaFinishedRaceBackfillError["kind"];
    message: string;
  }) {
    super(input.message);
    this.name = "DnaFinishedRaceBackfillError";
    this.kind = input.kind;
  }
}

function backfillError(
  kind: DnaFinishedRaceBackfillError["kind"],
  message: string,
): never {
  throw new DnaFinishedRaceBackfillError({ kind, message });
}

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    backfillError(
      "invalid_checkpoint",
      `${field} must be a non-negative safe integer`,
    );
  }
  return value;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    backfillError(
      "invalid_configuration",
      `${field} must be a positive safe integer`,
    );
  }
  return value;
}

function timestampMilliseconds(value: string, field: string): number {
  if (typeof value !== "string" || value.trim() === "") {
    backfillError("invalid_checkpoint", `${field} is required`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    backfillError(
      "invalid_checkpoint",
      `${field} must be a valid ISO timestamp`,
    );
  }
  return milliseconds;
}

function normalizeWindow(
  window: DnaFinishedRaceWindow,
  field: string,
): DnaFinishedRaceWindow {
  const startMilliseconds = timestampMilliseconds(
    window.startTime,
    `${field}.startTime`,
  );
  const endMilliseconds = timestampMilliseconds(
    window.endTime,
    `${field}.endTime`,
  );
  if (startMilliseconds > endMilliseconds) {
    backfillError(
      "invalid_checkpoint",
      `${field}.startTime cannot be after ${field}.endTime`,
    );
  }
  return Object.freeze({
    startTime: new Date(startMilliseconds).toISOString(),
    endTime: new Date(endMilliseconds).toISOString(),
  });
}

function windowIdentity(window: DnaFinishedRaceWindow): string {
  return `${window.startTime}|${window.endTime}`;
}

function validateCheckpoint(
  checkpoint: DnaFinishedRaceBackfillCheckpoint,
): DnaFinishedRaceBackfillCheckpoint {
  if (checkpoint.version !== DNA_FINISHED_RACE_BACKFILL_CHECKPOINT_VERSION) {
    backfillError(
      "invalid_checkpoint",
      "finished-race backfill checkpoint version is unsupported",
    );
  }

  const rootWindow = normalizeWindow(checkpoint.rootWindow, "rootWindow");
  const rootStart = Date.parse(rootWindow.startTime);
  const rootEnd = Date.parse(rootWindow.endTime);
  const minimumWindowMilliseconds = positiveSafeInteger(
    checkpoint.minimumWindowMilliseconds,
    "minimumWindowMilliseconds",
  );

  if (
    checkpoint.pendingWindows.length >
    DNA_FINISHED_RACE_BACKFILL_MAX_PENDING_WINDOWS
  ) {
    backfillError(
      "invalid_checkpoint",
      `pendingWindows exceeds the ${DNA_FINISHED_RACE_BACKFILL_MAX_PENDING_WINDOWS}-window safety bound`,
    );
  }

  const seen = new Set<string>();
  const pendingWindows = checkpoint.pendingWindows.map((window, index) => {
    const normalized = normalizeWindow(window, `pendingWindows[${index}]`);
    const start = Date.parse(normalized.startTime);
    const end = Date.parse(normalized.endTime);
    if (start < rootStart || end > rootEnd) {
      backfillError(
        "invalid_checkpoint",
        "pending window falls outside the root backfill range",
      );
    }
    const identity = windowIdentity(normalized);
    if (seen.has(identity)) {
      backfillError(
        "invalid_checkpoint",
        "pendingWindows contains a duplicate window",
      );
    }
    seen.add(identity);
    return normalized;
  });

  return Object.freeze({
    version: DNA_FINISHED_RACE_BACKFILL_CHECKPOINT_VERSION,
    rootWindow,
    pendingWindows: Object.freeze(pendingWindows),
    minimumWindowMilliseconds,
    completedWindowCount: nonNegativeSafeInteger(
      checkpoint.completedWindowCount,
      "completedWindowCount",
    ),
    splitCount: nonNegativeSafeInteger(checkpoint.splitCount, "splitCount"),
    successfulFinishedRaceRequestCount: nonNegativeSafeInteger(
      checkpoint.successfulFinishedRaceRequestCount,
      "successfulFinishedRaceRequestCount",
    ),
    raceDocumentRequestCount: nonNegativeSafeInteger(
      checkpoint.raceDocumentRequestCount,
      "raceDocumentRequestCount",
    ),
    publishedWindowDocumentCount: nonNegativeSafeInteger(
      checkpoint.publishedWindowDocumentCount,
      "publishedWindowDocumentCount",
    ),
  });
}

function checkpointWith(
  checkpoint: DnaFinishedRaceBackfillCheckpoint,
  changes: Partial<DnaFinishedRaceBackfillCheckpoint>,
): DnaFinishedRaceBackfillCheckpoint {
  return validateCheckpoint({ ...checkpoint, ...changes });
}

function raceKey(rid: DnaRaceIdentifier): string {
  if (typeof rid === "number") {
    if (!Number.isSafeInteger(rid) || rid < 1) {
      backfillError(
        "duplicate_race",
        "finished-race response contains an invalid race id",
      );
    }
    return String(rid);
  }
  const normalized = rid.trim();
  if (normalized === "") {
    backfillError(
      "duplicate_race",
      "finished-race response contains an empty race id",
    );
  }
  return normalized;
}

function uniqueRaceIds(
  races: readonly DnaRaceDocument[],
): readonly DnaRaceIdentifier[] {
  const seen = new Map<string, string>();
  return Object.freeze(
    races.map((race) => {
      const key = raceKey(race.rid);
      const hash = dnaOpenLabRawEvidenceSha256(race);
      const existingHash = seen.get(key);
      if (existingHash !== undefined) {
        const suffix =
          existingHash === hash ? "duplicate" : "conflicting duplicate";
        backfillError(
          "duplicate_race",
          `finished-race response contains ${suffix} race ${key}`,
        );
      }
      seen.set(key, hash);
      return race.rid;
    }),
  );
}

function splitWindow(
  window: DnaFinishedRaceWindow,
  minimumWindowMilliseconds: number,
): readonly [DnaFinishedRaceWindow, DnaFinishedRaceWindow] {
  const start = Date.parse(window.startTime);
  const end = Date.parse(window.endTime);
  const width = end - start;
  if (width <= minimumWindowMilliseconds) {
    backfillError(
      "unprovable_saturation",
      `DNA finished-race window remains saturated at the minimum ${minimumWindowMilliseconds}ms width`,
    );
  }
  const midpoint = start + Math.floor(width / 2);
  if (midpoint <= start || midpoint >= end) {
    backfillError(
      "unprovable_saturation",
      "DNA finished-race window cannot be split further safely",
    );
  }
  return Object.freeze([
    Object.freeze({
      startTime: new Date(start).toISOString(),
      endTime: new Date(midpoint).toISOString(),
    }),
    Object.freeze({
      startTime: new Date(midpoint).toISOString(),
      endTime: new Date(end).toISOString(),
    }),
  ]);
}

function publicationHashes(input: {
  window: DnaFinishedRaceWindow;
  discoveredRaces: readonly DnaRaceDocument[];
  hydration: DnaRaceDocumentHydrationResult | null;
}): Readonly<{ windowKey: string; contentSha256: string }> {
  const windowKey = createHash("sha256")
    .update(
      `dna_open_lab|v1|races.finished|${windowIdentity(input.window)}`,
      "utf8",
    )
    .digest("hex");
  const contentSha256 = dnaOpenLabRawEvidenceSha256({
    source: "dna_open_lab",
    version: "v1",
    window: input.window,
    discoveredRaceHashes: input.discoveredRaces.map((race) =>
      dnaOpenLabRawEvidenceSha256(race),
    ),
    hydratedDocumentHashes:
      input.hydration?.documents.map(
        (document) => document.rawEvidenceSha256,
      ) ?? [],
  });
  return Object.freeze({ windowKey, contentSha256 });
}

function initialCheckpoint(input: {
  startTime: string;
  endTime: string;
  minimumWindowMilliseconds: number;
}): DnaFinishedRaceBackfillCheckpoint {
  const rootWindow = normalizeWindow(
    { startTime: input.startTime, endTime: input.endTime },
    "rootWindow",
  );
  return validateCheckpoint({
    version: DNA_FINISHED_RACE_BACKFILL_CHECKPOINT_VERSION,
    rootWindow,
    pendingWindows: Object.freeze([rootWindow]),
    minimumWindowMilliseconds: input.minimumWindowMilliseconds,
    completedWindowCount: 0,
    splitCount: 0,
    successfulFinishedRaceRequestCount: 0,
    raceDocumentRequestCount: 0,
    publishedWindowDocumentCount: 0,
  });
}

async function loadOrCreateCheckpoint(input: {
  repository: DnaFinishedRaceBackfillCheckpointRepository;
  startTime: string;
  endTime: string;
  minimumWindowMilliseconds: number;
}): Promise<StoredDnaFinishedRaceBackfillCheckpoint> {
  const existing = await input.repository.load();
  if (existing !== null) {
    const checkpoint = validateCheckpoint(existing.checkpoint);
    const requestedRoot = normalizeWindow(
      { startTime: input.startTime, endTime: input.endTime },
      "requestedRootWindow",
    );
    if (
      windowIdentity(checkpoint.rootWindow) !== windowIdentity(requestedRoot)
    ) {
      backfillError(
        "invalid_configuration",
        "requested backfill range differs from persisted checkpoint",
      );
    }
    if (
      checkpoint.minimumWindowMilliseconds !== input.minimumWindowMilliseconds
    ) {
      backfillError(
        "invalid_configuration",
        "minimumWindowMilliseconds differs from persisted checkpoint",
      );
    }
    return Object.freeze({ revision: existing.revision, checkpoint });
  }

  return input.repository.save({
    expectedRevision: null,
    checkpoint: initialCheckpoint(input),
  });
}

export async function runNextDnaFinishedRaceBackfillStep(input: {
  startTime: string;
  endTime: string;
  client: Pick<DnaOpenLabClient, "racesFinished" | "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  checkpointRepository: DnaFinishedRaceBackfillCheckpointRepository;
  publisher: DnaFinishedRaceWindowPublisher;
  observedAt: string;
  minimumWindowMilliseconds?: number;
}): Promise<DnaFinishedRaceBackfillStepResult> {
  const minimumWindowMilliseconds = positiveSafeInteger(
    input.minimumWindowMilliseconds ?? 1,
    "minimumWindowMilliseconds",
  );
  const stored = await loadOrCreateCheckpoint({
    repository: input.checkpointRepository,
    startTime: input.startTime,
    endTime: input.endTime,
    minimumWindowMilliseconds,
  });
  const checkpoint = stored.checkpoint;
  const currentWindow = checkpoint.pendingWindows[0];
  if (currentWindow === undefined) {
    return Object.freeze({ kind: "complete", stored });
  }

  const finishedResponse = await input.requestBudget.execute(() =>
    input.client.racesFinished({
      startTime: currentWindow.startTime,
      endTime: currentWindow.endTime,
      limit: DNA_FINISHED_RACE_WINDOW_LIMIT,
    }),
  );
  const races = finishedResponse.result;
  if (races.length > DNA_FINISHED_RACE_WINDOW_LIMIT) {
    backfillError(
      "source_limit_breach",
      `DNA finished-race window returned ${races.length} rows above the documented ${DNA_FINISHED_RACE_WINDOW_LIMIT}-row limit`,
    );
  }

  if (races.length === DNA_FINISHED_RACE_WINDOW_LIMIT) {
    const childWindows = splitWindow(currentWindow, minimumWindowMilliseconds);
    const nextCheckpoint = checkpointWith(checkpoint, {
      pendingWindows: Object.freeze([
        childWindows[0],
        childWindows[1],
        ...checkpoint.pendingWindows.slice(1),
      ]),
      splitCount: checkpoint.splitCount + 1,
      successfulFinishedRaceRequestCount:
        checkpoint.successfulFinishedRaceRequestCount + 1,
    });
    const nextStored = await input.checkpointRepository.save({
      expectedRevision: stored.revision,
      checkpoint: nextCheckpoint,
    });
    return Object.freeze({
      kind: "split",
      parentWindow: currentWindow,
      childWindows,
      stored: nextStored,
    });
  }

  const raceIds = uniqueRaceIds(races);
  const hydration =
    raceIds.length === 0
      ? null
      : await hydrateDnaRaceDocuments({
          raceIds,
          client: input.client,
          requestBudget: input.requestBudget,
          observedAt: input.observedAt,
        });
  const hydratedDocuments = hydration?.documents ?? Object.freeze([]);
  const hashes = publicationHashes({
    window: currentWindow,
    discoveredRaces: races,
    hydration,
  });
  const publicationReceipt = await input.publisher(
    Object.freeze({
      ...hashes,
      window: currentWindow,
      discoveredRaces: races,
      hydratedDocuments,
    }),
  );
  if (
    publicationReceipt.windowKey !== hashes.windowKey ||
    publicationReceipt.contentSha256 !== hashes.contentSha256 ||
    publicationReceipt.documentCount !== hydratedDocuments.length
  ) {
    backfillError(
      "publication_mismatch",
      "finished-race publisher receipt does not match the requested publication",
    );
  }

  const nextCheckpoint = checkpointWith(checkpoint, {
    pendingWindows: Object.freeze(checkpoint.pendingWindows.slice(1)),
    completedWindowCount: checkpoint.completedWindowCount + 1,
    successfulFinishedRaceRequestCount:
      checkpoint.successfulFinishedRaceRequestCount + 1,
    raceDocumentRequestCount:
      checkpoint.raceDocumentRequestCount + (hydration?.batchCount ?? 0),
    publishedWindowDocumentCount:
      checkpoint.publishedWindowDocumentCount + hydratedDocuments.length,
  });
  const nextStored = await input.checkpointRepository.save({
    expectedRevision: stored.revision,
    checkpoint: nextCheckpoint,
  });
  return Object.freeze({
    kind: "published",
    window: currentWindow,
    publicationReceipt,
    stored: nextStored,
  });
}
