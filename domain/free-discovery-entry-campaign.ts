export const freeDiscoveryEntryCampaignSchemaVersion =
  "free-discovery-entry-campaign/v1" as const;

export const freeDiscoveryEntryDistances = Object.freeze([
  1_000,
  1_200,
  1_400,
  1_600,
  1_800,
  2_000,
  2_200,
] as const);

export type FreeDiscoveryEntryDistance =
  (typeof freeDiscoveryEntryDistances)[number];

export type FreeDiscoveryEntryCampaign = Readonly<{
  schemaVersion: typeof freeDiscoveryEntryCampaignSchemaVersion;
  campaignId: string;
  authority: Readonly<{
    kind: "owner_instruction";
    confirmedAt: string;
    purpose: string;
  }>;
  mode: "horse";
  raceSelector: Readonly<{
    raceNameToken: "Free";
    raceClass: 90;
    gateCount: 4;
    sourceFormat: "normal";
    exactDistanceRequired: true;
  }>;
  execution: Readonly<{
    preferredExecutor: "dna_native_auto_entry";
    fallbackExecutor: "owner_authorized_local_entry_agent";
    plannedNewRacesPerCell: 5;
    maximumOwnedCoresPerRace: 2;
    twoOwnedCorePolicy:
      "challenger_plus_proven_same_mode_exact_distance_benchmark_only";
    cloudRaceEntryAllowed: false;
    localExecutorCommissioned: false;
    ownerAuthorizedPlanConsumption: true;
    automaticBurnDecisionAllowed: false;
    automaticStopFromNoStarAllowed: false;
    idempotencyKeyScheme: string;
  }>;
  progress: Readonly<{
    doNotRepeatCompletedCells: true;
    completionAuthority: "authoritative_reconciled_finished_race";
    resultsFeedRound2: true;
  }>;
  summary: Readonly<{
    ownedCoreAuditCount: number;
    coreDistanceCellCount: number;
    plannedRaceCount: number;
    distanceCellCounts: Readonly<Record<string, number>>;
  }>;
  distanceQueues: Readonly<Record<string, readonly string[]>>;
  contentSha256: string;
}>;

export type FreeDiscoveryEntryIntent = Readonly<{
  campaignId: string;
  coreId: string;
  distanceMetres: FreeDiscoveryEntryDistance;
  raceOrdinal: number;
  idempotencyKey: string;
  selector: FreeDiscoveryEntryCampaign["raceSelector"];
  maximumOwnedCoresPerRace: 2;
  twoOwnedCorePolicy:
    "challenger_plus_proven_same_mode_exact_distance_benchmark_only";
}>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CORE_ID_PATTERN = /^[1-9]\d*$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

function canonicalTimestamp(value: unknown, label: string): string {
  const normalized = requiredString(value, label);
  const parsed = new Date(normalized);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== normalized
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return normalized;
}

function literal<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
  return expected;
}

function distanceKey(value: number): string {
  return String(value);
}

function renderIdempotencyKey(
  scheme: string,
  input: Readonly<{
    campaignId: string;
    coreId: string;
    distanceMetres: number;
    raceOrdinal: number;
  }>,
): string {
  return scheme
    .replaceAll("{campaignId}", input.campaignId)
    .replaceAll("{coreId}", input.coreId)
    .replaceAll("{distanceMetres}", String(input.distanceMetres))
    .replaceAll("{raceOrdinal}", String(input.raceOrdinal));
}

export function validateFreeDiscoveryEntryCampaign(
  input: unknown,
): FreeDiscoveryEntryCampaign {
  const root = record(input, "Free Discovery entry campaign");
  literal(
    root.schemaVersion,
    freeDiscoveryEntryCampaignSchemaVersion,
    "Campaign schema version",
  );

  const campaignId = requiredString(root.campaignId, "Campaign ID");
  const authority = record(root.authority, "Campaign authority");
  literal(authority.kind, "owner_instruction", "Campaign authority kind");
  const confirmedAt = canonicalTimestamp(
    authority.confirmedAt,
    "Campaign authority time",
  );
  const purpose = requiredString(authority.purpose, "Campaign purpose");

  literal(root.mode, "horse", "Campaign mode");

  const selector = record(root.raceSelector, "Campaign race selector");
  literal(selector.raceNameToken, "Free", "Race name token");
  literal(selector.raceClass, 90, "Race class");
  literal(selector.gateCount, 4, "Gate count");
  literal(selector.sourceFormat, "normal", "Source format");
  literal(selector.exactDistanceRequired, true, "Exact-distance requirement");

  const execution = record(root.execution, "Campaign execution");
  literal(
    execution.preferredExecutor,
    "dna_native_auto_entry",
    "Preferred executor",
  );
  literal(
    execution.fallbackExecutor,
    "owner_authorized_local_entry_agent",
    "Fallback executor",
  );
  literal(
    execution.plannedNewRacesPerCell,
    5,
    "Planned new races per cell",
  );
  literal(
    execution.maximumOwnedCoresPerRace,
    2,
    "Maximum owned Cores per race",
  );
  literal(
    execution.twoOwnedCorePolicy,
    "challenger_plus_proven_same_mode_exact_distance_benchmark_only",
    "Two-owned-Core Discovery policy",
  );
  literal(
    execution.cloudRaceEntryAllowed,
    false,
    "Cloud race-entry permission",
  );
  literal(
    execution.localExecutorCommissioned,
    false,
    "Local executor commissioned flag",
  );
  literal(
    execution.ownerAuthorizedPlanConsumption,
    true,
    "Owner plan-consumption authority",
  );
  literal(
    execution.automaticBurnDecisionAllowed,
    false,
    "Automatic burn decision flag",
  );
  literal(
    execution.automaticStopFromNoStarAllowed,
    false,
    "Automatic no-star stop flag",
  );
  const idempotencyKeyScheme = requiredString(
    execution.idempotencyKeyScheme,
    "Idempotency key scheme",
  );
  for (const placeholder of [
    "{coreId}",
    "{distanceMetres}",
    "{raceOrdinal}",
  ]) {
    if (!idempotencyKeyScheme.includes(placeholder)) {
      throw new Error(
        `Idempotency key scheme is missing ${placeholder}.`,
      );
    }
  }

  const progress = record(root.progress, "Campaign progress policy");
  literal(
    progress.doNotRepeatCompletedCells,
    true,
    "Completed-cell replay policy",
  );
  literal(
    progress.completionAuthority,
    "authoritative_reconciled_finished_race",
    "Completion authority",
  );
  literal(progress.resultsFeedRound2, true, "Round-2 result policy");

  const summary = record(root.summary, "Campaign summary");
  const ownedCoreAuditCount = positiveInteger(
    summary.ownedCoreAuditCount,
    "Owned Core audit count",
  );
  const coreDistanceCellCount = positiveInteger(
    summary.coreDistanceCellCount,
    "Core-distance cell count",
  );
  const plannedRaceCount = positiveInteger(
    summary.plannedRaceCount,
    "Planned race count",
  );
  const distanceCellCountsRaw = record(
    summary.distanceCellCounts,
    "Distance cell counts",
  );

  const queuesRaw = record(root.distanceQueues, "Distance queues");
  const distanceQueues: Record<string, readonly string[]> = {};
  const distanceCellCounts: Record<string, number> = {};
  const seenCells = new Set<string>();
  let countedCells = 0;

  for (const distance of freeDiscoveryEntryDistances) {
    const key = distanceKey(distance);
    const queue = queuesRaw[key];
    if (!Array.isArray(queue)) {
      throw new Error(`Distance queue ${key} must be an array.`);
    }
    const normalized = queue.map((value, index) => {
      const coreId = requiredString(
        value,
        `Distance ${key} Core ID #${index + 1}`,
      );
      if (!CORE_ID_PATTERN.test(coreId)) {
        throw new Error(`Distance ${key} contains an invalid Core ID.`);
      }
      const cellKey = `${coreId}:${key}`;
      if (seenCells.has(cellKey)) {
        throw new Error(`Duplicate campaign cell ${cellKey}.`);
      }
      seenCells.add(cellKey);
      return coreId;
    });
    if (new Set(normalized).size !== normalized.length) {
      throw new Error(`Distance queue ${key} contains duplicate Cores.`);
    }
    distanceQueues[key] = Object.freeze(normalized);
    distanceCellCounts[key] = normalized.length;
    countedCells += normalized.length;

    const expectedCount = positiveInteger(
      distanceCellCountsRaw[key],
      `Distance ${key} summary count`,
    );
    if (expectedCount !== normalized.length) {
      throw new Error(`Distance ${key} summary count is inconsistent.`);
    }
  }

  const unexpectedDistance = Object.keys(queuesRaw).find(
    (key) => !freeDiscoveryEntryDistances.some((distance) => String(distance) === key),
  );
  if (unexpectedDistance !== undefined) {
    throw new Error(
      `Unsupported Free Discovery distance queue ${unexpectedDistance}.`,
    );
  }

  if (countedCells !== coreDistanceCellCount) {
    throw new Error("Campaign Core-distance cell count is inconsistent.");
  }
  if (plannedRaceCount !== countedCells * 5) {
    throw new Error("Campaign planned race count is inconsistent.");
  }

  const contentSha256 = requiredString(
    root.contentSha256,
    "Campaign content SHA-256",
  );
  if (!SHA256_PATTERN.test(contentSha256)) {
    throw new Error("Campaign content SHA-256 is invalid.");
  }

  return Object.freeze({
    schemaVersion: freeDiscoveryEntryCampaignSchemaVersion,
    campaignId,
    authority: Object.freeze({
      kind: "owner_instruction" as const,
      confirmedAt,
      purpose,
    }),
    mode: "horse" as const,
    raceSelector: Object.freeze({
      raceNameToken: "Free" as const,
      raceClass: 90 as const,
      gateCount: 4 as const,
      sourceFormat: "normal" as const,
      exactDistanceRequired: true as const,
    }),
    execution: Object.freeze({
      preferredExecutor: "dna_native_auto_entry" as const,
      fallbackExecutor: "owner_authorized_local_entry_agent" as const,
      plannedNewRacesPerCell: 5 as const,
      maximumOwnedCoresPerRace: 2 as const,
      twoOwnedCorePolicy:
        "challenger_plus_proven_same_mode_exact_distance_benchmark_only" as const,
      cloudRaceEntryAllowed: false as const,
      localExecutorCommissioned: false as const,
      ownerAuthorizedPlanConsumption: true as const,
      automaticBurnDecisionAllowed: false as const,
      automaticStopFromNoStarAllowed: false as const,
      idempotencyKeyScheme,
    }),
    progress: Object.freeze({
      doNotRepeatCompletedCells: true as const,
      completionAuthority:
        "authoritative_reconciled_finished_race" as const,
      resultsFeedRound2: true as const,
    }),
    summary: Object.freeze({
      ownedCoreAuditCount,
      coreDistanceCellCount,
      plannedRaceCount,
      distanceCellCounts: Object.freeze(distanceCellCounts),
    }),
    distanceQueues: Object.freeze(distanceQueues),
    contentSha256,
  });
}

export function freeDiscoveryEntryCellKey(
  coreId: string,
  distanceMetres: FreeDiscoveryEntryDistance,
): string {
  if (!CORE_ID_PATTERN.test(coreId)) {
    throw new Error("Free Discovery Core ID is invalid.");
  }
  if (!freeDiscoveryEntryDistances.includes(distanceMetres)) {
    throw new Error("Free Discovery distance is unsupported.");
  }
  return `${coreId}:${distanceMetres}`;
}

export function buildPendingFreeDiscoveryEntryIntents(
  campaign: FreeDiscoveryEntryCampaign,
  completedRaceCounts: Readonly<Record<string, number>> = {},
): readonly FreeDiscoveryEntryIntent[] {
  const intents: FreeDiscoveryEntryIntent[] = [];
  for (const distanceMetres of freeDiscoveryEntryDistances) {
    const key = distanceKey(distanceMetres);
    const queue = campaign.distanceQueues[key] ?? [];
    for (const coreId of queue) {
      const cellKey = freeDiscoveryEntryCellKey(coreId, distanceMetres);
      const completed = completedRaceCounts[cellKey] ?? 0;
      if (
        !Number.isSafeInteger(completed) ||
        completed < 0 ||
        completed > campaign.execution.plannedNewRacesPerCell
      ) {
        throw new Error(
          `Completed race count for ${cellKey} is invalid.`,
        );
      }
      for (
        let raceOrdinal = completed + 1;
        raceOrdinal <= campaign.execution.plannedNewRacesPerCell;
        raceOrdinal += 1
      ) {
        intents.push(
          Object.freeze({
            campaignId: campaign.campaignId,
            coreId,
            distanceMetres,
            raceOrdinal,
            idempotencyKey: renderIdempotencyKey(
              campaign.execution.idempotencyKeyScheme,
              {
                campaignId: campaign.campaignId,
                coreId,
                distanceMetres,
                raceOrdinal,
              },
            ),
            selector: campaign.raceSelector,
            maximumOwnedCoresPerRace: 2 as const,
            twoOwnedCorePolicy:
              "challenger_plus_proven_same_mode_exact_distance_benchmark_only" as const,
          }),
        );
      }
    }
  }
  return Object.freeze(intents);
}
