import {
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  type DnaCurrentStateAcquisitionSchedule,
  type DnaScheduledCurrentStateRequest,
} from "./dna-open-lab-current-state-acquisition-cadence";
import {
  validateDnaCurrentStateAcquisitionCycleCheckpoint,
  type DnaCurrentStateAcquisitionCycleCheckpoint,
  type DnaCurrentStateAcquisitionEvidenceReceipt,
} from "./dna-open-lab-current-state-acquisition-runner";
import type { DnaOpenLabStoredCurrentStateEvidence } from "./dna-open-lab-r2-current-state-evidence";
import type { DnaCurrentStateRequest } from "./dna-open-lab-current-state-sync-plan";
import type { DnaCurrentStateCandidate } from "./dna-open-lab-last-good-publication";
import { createDnaCurrentRaceMaterialization } from "./dna-open-lab-current-race-materialization";
import { createDnaSupplementalCoreMaterialization } from "./dna-open-lab-core-current-state-materialization";
import { createDnaTokenSpliceMaterialization } from "./dna-open-lab-token-splice-materialization";
import type { NeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";
import {
  adaptDnaActiveRace,
  adaptDnaCoreAttachedAssets,
  adaptDnaCoreInfo,
  adaptDnaCoreListingPrice,
  adaptDnaCoreOwner,
  adaptDnaCorePower,
  adaptDnaCoreRacingStats,
  adaptDnaCoreSplicingInfo,
  adaptDnaCoreStamina,
  adaptDnaRaceFill,
  adaptDnaSpliceArenaPage,
  adaptDnaTokenPrices,
  adaptDnaVaultCore,
  dnaOpenLabRawEvidenceSha256,
  type CanonicalActiveRaceSnapshot,
  type CanonicalCoreAttachedAssetsSnapshot,
  type CanonicalCoreListingSnapshot,
  type CanonicalCoreOwnerSnapshot,
  type CanonicalCorePowerSnapshot,
  type CanonicalCoreRacingStatsSnapshot,
  type CanonicalCoreSplicingSnapshot,
  type CanonicalCoreStaminaSnapshot,
  type CanonicalRaceFillSnapshot,
  type CanonicalSpliceArenaPageSnapshot,
  type DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";
import type {
  DnaActiveRace,
  DnaCoreAttachedAssets,
  DnaCoreInfo,
  DnaCoreListingPrice,
  DnaCoreOwner,
  DnaCorePower,
  DnaCoreRacingStats,
  DnaCoreSplicingInfo,
  DnaCoreStamina,
  DnaRaceFill,
  DnaRaceMode,
  DnaSpliceArenaResult,
  DnaTokenPrices,
  DnaVaultCore,
} from "./dna-open-lab-v1-client";
import type { AdaptedCoreDetailsRow } from "../domain/source-adapters";

type PublicationRequest = Parameters<
  NeonDnaOpenLabSyncPublicationRepository["publishCandidate"]
>[0];

export type DnaCurrentStatePublicationAssembly = Omit<
  PublicationRequest,
  "ownerId" | "recordedAt" | "acceptedAt"
>;

function publicationError(message: string): never {
  throw new Error(`DNA Open Lab current-state publication runner: ${message}`);
}

function entries(
  schedule: DnaCurrentStateAcquisitionSchedule,
): readonly DnaScheduledCurrentStateRequest[] {
  return Object.freeze(schedule.requestBatches.flat());
}

function requestKey(entry: DnaScheduledCurrentStateRequest): string {
  return dnaOpenLabRawEvidenceSha256({
    group: entry.group,
    request: entry.request,
  });
}

function resultArray<T>(
  evidence: DnaOpenLabStoredCurrentStateEvidence,
): readonly T[] {
  if (!Array.isArray(evidence.response.result)) {
    publicationError(`${evidence.request.endpoint} result must be an array`);
  }
  return evidence.response.result as readonly T[];
}

function resultObject<T extends object>(
  evidence: DnaOpenLabStoredCurrentStateEvidence,
): T {
  const result = evidence.response.result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    publicationError(`${evidence.request.endpoint} result must be an object`);
  }
  return result as T;
}

function arenaMode(request: DnaCurrentStateRequest): DnaRaceMode {
  const filter = request.payload.filter;
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
    return publicationError("splice Arena request filter is invalid");
  }
  const mode = (filter as Record<string, unknown>).rvmode;
  if (mode !== "bike" && mode !== "car" && mode !== "horse") {
    return publicationError("splice Arena request mode is invalid");
  }
  return mode;
}

function oneEvidence(
  values: readonly DnaOpenLabStoredCurrentStateEvidence[],
  endpoint: DnaCurrentStateRequest["endpoint"],
): DnaOpenLabStoredCurrentStateEvidence {
  const matches = values.filter((value) => value.request.endpoint === endpoint);
  if (matches.length !== 1) {
    publicationError(`${endpoint} requires exactly one request observation`);
  }
  return matches[0]!;
}

function adaptArray<T, C>(input: {
  evidence: readonly DnaOpenLabStoredCurrentStateEvidence[];
  endpoint: DnaCurrentStateRequest["endpoint"];
  adapt: (raw: T, observedAt: string) => DnaOpenLabEvidence<C>;
}): readonly DnaOpenLabEvidence<C>[] {
  return Object.freeze(
    input.evidence
      .filter((value) => value.request.endpoint === input.endpoint)
      .flatMap((value) =>
        resultArray<T>(value).map((raw) => input.adapt(raw, value.observedAt)),
      ),
  );
}

function exactCurrentStateAuthority(
  schedule: DnaCurrentStateAcquisitionSchedule,
): void {
  if (
    schedule.status !== "ready" ||
    schedule.completionScope !== "all_current_state" ||
    schedule.onDemandPairRequestCount !== 0 ||
    JSON.stringify(schedule.dueGroups) !==
      JSON.stringify(DNA_CURRENT_STATE_ACQUISITION_GROUPS)
  ) {
    publicationError(
      "only a complete all-current-state acquisition may publish",
    );
  }
  const scheduled = entries(schedule);
  if (
    scheduled.length !== schedule.scheduledRequestCount ||
    scheduled.length < 1 ||
    new Set(scheduled.map(requestKey)).size !== scheduled.length
  ) {
    publicationError("scheduled request coverage is invalid");
  }
  for (const endpoint of [
    "vault.info",
    "vault.cores_full",
    "vault.tier_badge",
    "vault.recent_races",
    "races.active",
    "tokens.prices",
  ] as const) {
    if (
      scheduled.filter((entry) => entry.request.endpoint === endpoint)
        .length !== 1
    ) {
      publicationError(`${endpoint} requires exactly one scheduled request`);
    }
  }
  if (!scheduled.some((entry) => entry.request.endpoint === "splice.arena")) {
    publicationError("at least one complete splice Arena mode is required");
  }
}

function validateStoredEvidence(input: {
  cycleId: string;
  entry: DnaScheduledCurrentStateRequest;
  receipt: DnaCurrentStateAcquisitionEvidenceReceipt;
  evidence: DnaOpenLabStoredCurrentStateEvidence;
}): DnaOpenLabStoredCurrentStateEvidence {
  if (
    input.evidence.cycleId !== input.cycleId ||
    input.evidence.requestKey !== input.receipt.requestKey ||
    input.evidence.observedAt !== input.receipt.observedAt ||
    input.evidence.group !== input.entry.group ||
    requestKey({
      group: input.evidence.group,
      request: input.evidence.request,
    }) !== input.receipt.requestKey
  ) {
    publicationError("stored evidence does not match its schedule receipt");
  }
  return input.evidence;
}

function assertCoreInfoCoverage(input: {
  ownedCores: readonly DnaOpenLabEvidence<AdaptedCoreDetailsRow>[];
  coreInfo: readonly DnaOpenLabEvidence<AdaptedCoreDetailsRow>[];
}): void {
  const expected = input.ownedCores
    .map((value) => value.canonical.sourceCoreId)
    .sort((left, right) => Number(left) - Number(right));
  const actual = input.coreInfo
    .map((value) => value.canonical.sourceCoreId)
    .sort((left, right) => Number(left) - Number(right));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    publicationError("Core-info coverage does not match Vault ownership");
  }
}

function assertRaceFillCoverage(input: {
  activeRaces: readonly DnaOpenLabEvidence<CanonicalActiveRaceSnapshot>[];
  raceFills: readonly DnaOpenLabEvidence<CanonicalRaceFillSnapshot>[];
}): void {
  const activeIds = input.activeRaces
    .map((value) => value.canonical.sourceRaceId)
    .sort((left, right) => left.localeCompare(right));
  const fillIds = input.raceFills
    .map((value) => value.canonical.sourceRaceId)
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(fillIds) !== JSON.stringify(activeIds)) {
    publicationError("race-fill coverage does not match active races");
  }
}

/**
 * Reconstructs one complete current-state generation from verified immutable
 * request evidence. This boundary intentionally accepts only a first/full
 * all-family acquisition. Later staggered cadence cycles must supply a durable
 * cached-family receipt index before they can reuse this publication path.
 */
export async function assembleDnaCurrentStatePublication(input: {
  cycleId: string;
  schedule: DnaCurrentStateAcquisitionSchedule;
  checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  validatedAt: string;
  readEvidence: (input: {
    cycleId: string;
    receipt: DnaCurrentStateAcquisitionEvidenceReceipt;
  }) => Promise<DnaOpenLabStoredCurrentStateEvidence>;
}): Promise<DnaCurrentStatePublicationAssembly> {
  exactCurrentStateAuthority(input.schedule);
  const checkpoint = validateDnaCurrentStateAcquisitionCycleCheckpoint({
    checkpoint: input.checkpoint,
    cycleId: input.cycleId,
    schedule: input.schedule,
    validatedAt: input.validatedAt,
  });
  if (checkpoint.status !== "ready_to_publish") {
    publicationError("acquisition checkpoint is not ready to publish");
  }

  const scheduled = entries(input.schedule);
  const receiptByKey = new Map(
    checkpoint.receipts.map((receipt) => [receipt.requestKey, receipt]),
  );
  const evidence: DnaOpenLabStoredCurrentStateEvidence[] = [];
  for (const entry of scheduled) {
    const key = requestKey(entry);
    const receipt = receiptByKey.get(key);
    if (receipt === undefined) {
      publicationError("scheduled request receipt is unavailable");
    }
    evidence.push(
      validateStoredEvidence({
        cycleId: checkpoint.cycleId,
        entry,
        receipt,
        evidence: await input.readEvidence({
          cycleId: checkpoint.cycleId,
          receipt,
        }),
      }),
    );
  }

  // These reference endpoints are required for full-cycle authority even
  // though the compact current read model does not duplicate their raw shapes.
  resultObject(oneEvidence(evidence, "vault.info"));
  resultObject(oneEvidence(evidence, "vault.tier_badge"));
  resultArray(oneEvidence(evidence, "vault.recent_races"));

  const ownership = oneEvidence(evidence, "vault.cores_full");
  const ownedCores = Object.freeze(
    resultArray<DnaVaultCore>(ownership).map((raw) =>
      adaptDnaVaultCore({ raw, observedAt: ownership.observedAt }),
    ),
  );
  const activeObservation = oneEvidence(evidence, "races.active");
  const activeRaces = Object.freeze(
    resultArray<DnaActiveRace>(activeObservation).map((raw) =>
      adaptDnaActiveRace({ raw, observedAt: activeObservation.observedAt }),
    ),
  );
  const raceFills = adaptArray<DnaRaceFill, CanonicalRaceFillSnapshot>({
    evidence,
    endpoint: "races.fills",
    adapt: (raw, observedAt) => adaptDnaRaceFill({ raw, observedAt }),
  });
  assertRaceFillCoverage({ activeRaces, raceFills });
  const coreInfo = adaptArray<DnaCoreInfo, AdaptedCoreDetailsRow>({
    evidence,
    endpoint: "cores.info_bulk",
    adapt: (raw, observedAt) => adaptDnaCoreInfo({ raw, observedAt }),
  });
  assertCoreInfoCoverage({ ownedCores, coreInfo });

  const racingStats = adaptArray<
    DnaCoreRacingStats,
    CanonicalCoreRacingStatsSnapshot
  >({
    evidence,
    endpoint: "cores.racing_stats_bulk",
    adapt: (raw, observedAt) => adaptDnaCoreRacingStats({ raw, observedAt }),
  });
  const power = adaptArray<DnaCorePower, CanonicalCorePowerSnapshot>({
    evidence,
    endpoint: "cores.power_bulk",
    adapt: (raw, observedAt) => adaptDnaCorePower({ raw, observedAt }),
  });
  const listings = adaptArray<
    DnaCoreListingPrice,
    CanonicalCoreListingSnapshot
  >({
    evidence,
    endpoint: "cores.listing_price_bulk",
    adapt: (raw, observedAt) => adaptDnaCoreListingPrice({ raw, observedAt }),
  });
  const attachedAssets = adaptArray<
    DnaCoreAttachedAssets,
    CanonicalCoreAttachedAssetsSnapshot
  >({
    evidence,
    endpoint: "cores.attached_assets_bulk",
    adapt: (raw, observedAt) => adaptDnaCoreAttachedAssets({ raw, observedAt }),
  });
  const owners = adaptArray<DnaCoreOwner, CanonicalCoreOwnerSnapshot>({
    evidence,
    endpoint: "cores.owner_bulk",
    adapt: (raw, observedAt) => adaptDnaCoreOwner({ raw, observedAt }),
  });
  const stamina = adaptArray<DnaCoreStamina, CanonicalCoreStaminaSnapshot>({
    evidence,
    endpoint: "cores.stamina_bulk",
    adapt: (raw, observedAt) => adaptDnaCoreStamina({ raw, observedAt }),
  });
  const splicing = adaptArray<
    DnaCoreSplicingInfo,
    CanonicalCoreSplicingSnapshot
  >({
    evidence,
    endpoint: "cores.splicing_info_bulk",
    adapt: (raw, observedAt) => adaptDnaCoreSplicingInfo({ raw, observedAt }),
  });

  const tokenObservation = oneEvidence(evidence, "tokens.prices");
  const tokenPrices = adaptDnaTokenPrices({
    raw: resultObject<DnaTokenPrices>(tokenObservation),
    observedAt: tokenObservation.observedAt,
  });
  const arenaPages: DnaOpenLabEvidence<CanonicalSpliceArenaPageSnapshot>[] = [];
  const arenaModes = new Set<DnaRaceMode>();
  for (const value of evidence.filter(
    (item) => item.request.endpoint === "splice.arena",
  )) {
    const mode = arenaMode(value.request);
    arenaModes.add(mode);
    arenaPages.push(
      adaptDnaSpliceArenaPage({
        raw: resultObject<DnaSpliceArenaResult>(value),
        mode,
        observedAt: value.observedAt,
      }),
    );
  }

  const observedAt = evidence
    .map((value) => value.observedAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right))
    .at(-1)!;
  const candidate: DnaCurrentStateCandidate = Object.freeze({
    generationId: checkpoint.cycleId,
    observedAt,
    families: Object.freeze({
      vault: Object.freeze({ status: "complete", itemCount: 1 }),
      cores: Object.freeze({
        status: "complete",
        itemCount: ownedCores.length,
      }),
      active_races: Object.freeze({
        status: "complete",
        itemCount: activeRaces.length,
      }),
      race_fills: Object.freeze({
        status: "complete",
        itemCount: raceFills.length,
      }),
      tokens: Object.freeze({ status: "complete", itemCount: 1 }),
      splice_arena: Object.freeze({
        status: "complete",
        itemCount: arenaPages.length,
      }),
    }),
  });

  const supplementalCore = Object.freeze({
    racingStats,
    power,
    listings,
    attachedAssets,
    owners,
    stamina,
    splicing,
  });
  const tokenSplice = Object.freeze({
    tokenPrices,
    arenaModes: Object.freeze([...arenaModes]),
    arenaPages: Object.freeze(arenaPages),
  });

  // Run every complete-family validator before crossing into the repository.
  // The repository deliberately repeats these checks inside its transaction
  // boundary so neither caller nor storage adapter can weaken the contract.
  createDnaCurrentRaceMaterialization({ candidate, activeRaces, raceFills });
  createDnaSupplementalCoreMaterialization({
    candidate,
    sourceCoreIds: ownedCores.map((value) => value.canonical.sourceCoreId),
    ...supplementalCore,
  });
  createDnaTokenSpliceMaterialization({ candidate, ...tokenSplice });

  return Object.freeze({
    candidate,
    ownedCores,
    activeRaces:
      activeRaces as readonly DnaOpenLabEvidence<CanonicalActiveRaceSnapshot>[],
    raceFills,
    supplementalCore,
    tokenSplice,
  });
}

/** Publishes exactly once after every immutable receipt has been revalidated. */
export async function publishDnaCurrentStateAcquisitionCycle(input: {
  ownerId: string;
  cycleId: string;
  schedule: DnaCurrentStateAcquisitionSchedule;
  checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  validatedAt: string;
  recordedAt: string;
  acceptedAt: string;
  readEvidence: (input: {
    cycleId: string;
    receipt: DnaCurrentStateAcquisitionEvidenceReceipt;
  }) => Promise<DnaOpenLabStoredCurrentStateEvidence>;
  publicationRepository: NeonDnaOpenLabSyncPublicationRepository;
}) {
  const assembled = await assembleDnaCurrentStatePublication(input);
  return input.publicationRepository.publishCandidate({
    ownerId: input.ownerId,
    recordedAt: input.recordedAt,
    acceptedAt: input.acceptedAt,
    ...assembled,
  });
}
