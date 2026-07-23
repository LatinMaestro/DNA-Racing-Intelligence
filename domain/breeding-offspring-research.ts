export type ResearchMode = "Bike" | "Car" | "Horse";

export type ParentResearchSnapshot = Readonly<{
  coreId: string;
  mode: ResearchMode;
  exactDistanceM: number;
  raceCount: number;
  medianElapsedMs: number;
  goldReceived: number;
  goldOpportunities: number;
  blueReceived: number;
  blueOpportunities: number;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type OffspringResearchOutcome = Readonly<{
  eventId: string;
  offspringCoreId: string;
  eventAt: string;
  elapsedMs: number;
  goldStar: boolean | null;
  blueStar: boolean | null;
  goldEligible: boolean;
  starDataStatus: "complete" | "partial" | "missing" | "invalid";
}>;

export type ParentOffspringObservationInput = Readonly<{
  observationId: string;
  parentCoreIds: readonly [string, string];
  breedingAt: string;
  mode: ResearchMode;
  exactDistanceM: number;
  parentSnapshots: readonly [ParentResearchSnapshot, ParentResearchSnapshot];
  outcomes: readonly OffspringResearchOutcome[];
}>;

export type ParentOffspringResearchInput = Readonly<{
  holdoutStartsAt: string;
  observations: readonly ParentOffspringObservationInput[];
}>;

export type ParentOffspringExclusionReason =
  | "PARENT_FEATURE_AFTER_BREEDING"
  | "PARENT_FEATURE_STALE"
  | "PARENT_CELL_MISMATCH"
  | "OUTCOME_NOT_AFTER_BREEDING"
  | "OUTCOME_STAR_DATA_INCOMPLETE";

export type ParentOffspringResearchDataset = Readonly<{
  holdoutStartsAt: string;
  rows: readonly Readonly<{
    rowId: string;
    observationId: string;
    eventId: string;
    partition: "training" | "holdout";
    parentCoreIds: readonly [string, string];
    offspringCoreId: string;
    mode: ResearchMode;
    exactDistanceM: number;
    parentFeatures: readonly Readonly<{
      coreId: string;
      raceCount: number;
      sampleStatus: "hypothesis_only" | "minimally_analytical";
      medianElapsedMs: number;
      goldReceived: number;
      goldOpportunities: number;
      blueReceived: number;
      blueOpportunities: number;
      featureCutoff: string;
    }>[];
    outcome: Readonly<{
      eventAt: string;
      elapsedMs: number;
      goldStar: boolean | null;
      blueStar: boolean | null;
      goldEligible: boolean;
    }>;
  }>[];
  exclusions: readonly Readonly<{
    observationId: string;
    eventId: string;
    reasons: readonly ParentOffspringExclusionReason[];
  }>[];
  trainingRowCount: number;
  holdoutRowCount: number;
  historicalStarsUsedAsInheritedTrait: false;
  predictiveLiftClaimed: false;
  exceptionalOffspringProbabilityProduced: false;
  recommendationAllowed: false;
  gateEPassed: false;
}>;

const modes: readonly ResearchMode[] = ["Bike", "Car", "Horse"];

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function nonNegativeSafe(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function normalizeParent(
  input: ParentResearchSnapshot,
): ParentResearchSnapshot {
  const coreId = required(input.coreId, "Parent core ID");
  if (!modes.includes(input.mode)) throw new Error("Parent mode is invalid.");
  if (
    !Number.isSafeInteger(input.exactDistanceM) ||
    input.exactDistanceM <= 0
  ) {
    throw new Error("Parent exact distance must be a positive safe integer.");
  }
  nonNegativeSafe(input.raceCount, "Parent race count");
  if (
    !Number.isSafeInteger(input.medianElapsedMs) ||
    input.medianElapsedMs <= 0
  ) {
    throw new Error(
      "Parent median elapsed time must be a positive safe integer.",
    );
  }
  for (const [value, label] of [
    [input.goldReceived, "Parent Gold received"],
    [input.goldOpportunities, "Parent Gold opportunities"],
    [input.blueReceived, "Parent Blue received"],
    [input.blueOpportunities, "Parent Blue opportunities"],
  ] as const) {
    nonNegativeSafe(value, label);
  }
  if (
    input.goldReceived > input.goldOpportunities ||
    input.blueReceived > input.blueOpportunities ||
    input.goldOpportunities > input.raceCount ||
    input.blueOpportunities > input.raceCount
  ) {
    throw new Error(
      "Parent star numerators and denominators are inconsistent.",
    );
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Parent freshness is invalid.");
  }
  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Parent data current through",
  );
  const lastImported = timestamp(input.lastImported, "Parent last imported");
  if (Date.parse(lastImported) < Date.parse(dataCurrentThrough)) {
    throw new Error(
      "Parent last imported cannot precede data current through.",
    );
  }
  return { ...input, coreId, dataCurrentThrough, lastImported };
}

export function buildParentOffspringResearchDataset(
  input: ParentOffspringResearchInput,
): ParentOffspringResearchDataset {
  const holdoutStartsAt = timestamp(
    input.holdoutStartsAt,
    "Holdout start time",
  );
  const observationIds = new Set<string>();
  const eventIds = new Set<string>();
  const rows: ParentOffspringResearchDataset["rows"][number][] = [];
  const exclusions: ParentOffspringResearchDataset["exclusions"][number][] = [];

  for (const rawObservation of input.observations) {
    const observationId = required(
      rawObservation.observationId,
      "Research observation ID",
    );
    if (observationIds.has(observationId)) {
      throw new Error("Research observation IDs must be unique.");
    }
    observationIds.add(observationId);
    const breedingAt = timestamp(rawObservation.breedingAt, "Breeding time");
    if (!modes.includes(rawObservation.mode)) {
      throw new Error("Research observation mode is invalid.");
    }
    if (
      !Number.isSafeInteger(rawObservation.exactDistanceM) ||
      rawObservation.exactDistanceM <= 0
    ) {
      throw new Error(
        "Research observation distance must be a positive safe integer.",
      );
    }
    const parentCoreIds = rawObservation.parentCoreIds.map((coreId) =>
      required(coreId, "Observation parent core ID"),
    ) as [string, string];
    if (parentCoreIds[0] === parentCoreIds[1]) {
      throw new Error("Research observations require two distinct parents.");
    }
    const parentSnapshots = rawObservation.parentSnapshots.map(
      normalizeParent,
    ) as [ParentResearchSnapshot, ParentResearchSnapshot];
    if (
      parentSnapshots[0].coreId !== parentCoreIds[0] ||
      parentSnapshots[1].coreId !== parentCoreIds[1]
    ) {
      throw new Error("Parent snapshots must match the ordered parent IDs.");
    }

    for (const rawOutcome of rawObservation.outcomes) {
      const eventId = required(rawOutcome.eventId, "Offspring event ID");
      if (eventIds.has(eventId)) {
        throw new Error("Offspring event IDs must be unique across research.");
      }
      eventIds.add(eventId);
      const offspringCoreId = required(
        rawOutcome.offspringCoreId,
        "Offspring core ID",
      );
      if (parentCoreIds.includes(offspringCoreId)) {
        throw new Error("Offspring core ID cannot equal a parent core ID.");
      }
      const eventAt = timestamp(rawOutcome.eventAt, "Offspring event time");
      if (
        !Number.isSafeInteger(rawOutcome.elapsedMs) ||
        rawOutcome.elapsedMs <= 0
      ) {
        throw new Error(
          "Offspring elapsed time must be a positive safe integer.",
        );
      }
      if (
        !["complete", "partial", "missing", "invalid"].includes(
          rawOutcome.starDataStatus,
        )
      ) {
        throw new Error("Offspring star-data status is invalid.");
      }
      if (
        rawOutcome.starDataStatus !== "complete" &&
        (rawOutcome.goldStar !== null || rawOutcome.blueStar !== null)
      ) {
        throw new Error(
          "Incomplete offspring star data cannot carry star observations.",
        );
      }
      if (!rawOutcome.goldEligible && rawOutcome.goldStar === true) {
        throw new Error(
          "A Gold-ineligible offspring event cannot receive a Gold star.",
        );
      }

      const reasons = new Set<ParentOffspringExclusionReason>();
      if (
        parentSnapshots.some(
          (parent) =>
            Date.parse(parent.dataCurrentThrough) >= Date.parse(breedingAt),
        )
      ) {
        reasons.add("PARENT_FEATURE_AFTER_BREEDING");
      }
      if (
        parentSnapshots.some((parent) =>
          ["stale", "unknown"].includes(parent.freshness),
        )
      ) {
        reasons.add("PARENT_FEATURE_STALE");
      }
      if (
        parentSnapshots.some(
          (parent) =>
            parent.mode !== rawObservation.mode ||
            parent.exactDistanceM !== rawObservation.exactDistanceM,
        )
      ) {
        reasons.add("PARENT_CELL_MISMATCH");
      }
      if (Date.parse(eventAt) <= Date.parse(breedingAt)) {
        reasons.add("OUTCOME_NOT_AFTER_BREEDING");
      }
      if (rawOutcome.starDataStatus !== "complete") {
        reasons.add("OUTCOME_STAR_DATA_INCOMPLETE");
      }
      if (reasons.size > 0) {
        exclusions.push({
          observationId,
          eventId,
          reasons: [...reasons],
        });
        continue;
      }

      rows.push({
        rowId: `${observationId}:${eventId}`,
        observationId,
        eventId,
        partition:
          Date.parse(breedingAt) < Date.parse(holdoutStartsAt)
            ? "training"
            : "holdout",
        parentCoreIds,
        offspringCoreId,
        mode: rawObservation.mode,
        exactDistanceM: rawObservation.exactDistanceM,
        parentFeatures: parentSnapshots.map((parent) => ({
          coreId: parent.coreId,
          raceCount: parent.raceCount,
          sampleStatus:
            parent.raceCount < 10
              ? ("hypothesis_only" as const)
              : ("minimally_analytical" as const),
          medianElapsedMs: parent.medianElapsedMs,
          goldReceived: parent.goldReceived,
          goldOpportunities: parent.goldOpportunities,
          blueReceived: parent.blueReceived,
          blueOpportunities: parent.blueOpportunities,
          featureCutoff: parent.dataCurrentThrough,
        })),
        outcome: {
          eventAt,
          elapsedMs: rawOutcome.elapsedMs,
          goldStar: rawOutcome.goldStar,
          blueStar: rawOutcome.blueStar,
          goldEligible: rawOutcome.goldEligible,
        },
      });
    }
  }

  return {
    holdoutStartsAt,
    rows,
    exclusions,
    trainingRowCount: rows.filter(({ partition }) => partition === "training")
      .length,
    holdoutRowCount: rows.filter(({ partition }) => partition === "holdout")
      .length,
    historicalStarsUsedAsInheritedTrait: false,
    predictiveLiftClaimed: false,
    exceptionalOffspringProbabilityProduced: false,
    recommendationAllowed: false,
    gateEPassed: false,
  };
}
