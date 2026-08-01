export const maidenAllocationModes = ["bike", "car", "horse"] as const;
export type MaidenAllocationMode = (typeof maidenAllocationModes)[number];

export type MaidenAllocationBracketInput = Readonly<{
  tournamentId: string;
  tournamentLabel: string;
  bracketId: string;
  bracketLabel: string;
  mode: MaidenAllocationMode;
  configurationVersion: string;
  candidateSnapshotVersion: string;
  projectionVersion: string;
  reviewCapacity: number;
  availability: "upcoming" | "qualifying" | "closed";
  ruleStatus: "confirmed" | "uncertain";
}>;

export type MaidenAllocationCandidateInput = Readonly<{
  candidateId: string;
  coreId: string;
  tournamentId: string;
  bracketId: string;
  mode: MaidenAllocationMode;
  configurationVersion: string;
  candidateSnapshotVersion: string;
  projectionVersion: string;
  projectionBasis: "time_led_chronological";
  projectedValueBasisPoints: number;
  suitability: "review_candidate" | "preserve_me" | "hold";
  lifecycleState:
    | "eligible"
    | "planned"
    | "committed"
    | "consumed"
    | "not_eligible"
    | "unknown"
    | "invalid";
  evidenceConfidence: "high" | "moderate" | "low" | "unknown";
  timeEvidence: "strong" | "competitive" | "weak" | "unknown";
  historicalStarSupport: "supports" | "neutral" | "conflicts" | "unavailable";
  crossModeEvidenceComplete: boolean;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type MaidenAllocationCandidateStatus =
  | "provisionally_allocated"
  | "alternative_not_selected"
  | "preserve_me"
  | "held"
  | "entitlement_unavailable"
  | "bracket_unavailable"
  | "evidence_incomplete"
  | "capacity_unavailable";

export type MaidenVaultAllocation = Readonly<{
  assignments: readonly Readonly<{
    candidateId: string;
    coreId: string;
    tournamentId: string;
    tournamentLabel: string;
    bracketId: string;
    bracketLabel: string;
    mode: MaidenAllocationMode;
    configurationVersion: string;
    candidateSnapshotVersion: string;
    projectionVersion: string;
    projectedValueBasisPoints: number;
  }>[];
  candidates: readonly Readonly<{
    candidateId: string;
    coreId: string;
    tournamentId: string;
    tournamentLabel: string;
    bracketId: string;
    bracketLabel: string;
    mode: MaidenAllocationMode;
    configurationVersion: string;
    candidateSnapshotVersion: string;
    projectionVersion: string;
    projectedValueBasisPoints: number;
    lifecycleState: MaidenAllocationCandidateInput["lifecycleState"];
    evidenceConfidence: MaidenAllocationCandidateInput["evidenceConfidence"];
    timeEvidence: MaidenAllocationCandidateInput["timeEvidence"];
    historicalStarSupport: MaidenAllocationCandidateInput["historicalStarSupport"];
    starUsedForAllocation: false;
    crossModeEvidenceComplete: boolean;
    dataCurrentThrough: string | null;
    lastImported: string | null;
    freshness: MaidenAllocationCandidateInput["freshness"];
    status: MaidenAllocationCandidateStatus;
  }>[];
  objective: "maximum_total_projected_value_with_one_me_per_core";
  entitlementMutationsPerformed: false;
  importedHistoricalSnapshot: true;
  liveFieldAvailable: false;
  actionableRecommendationAllowed: false;
  maidenCommitmentAllowed: false;
  automaticEntryAllowed: false;
  warnings: readonly (
    | "GATE_C_NOT_PASSED"
    | "GATE_D_NOT_PASSED"
    | "PRESERVE_ME_PRESENT"
    | "UNALLOCATED_READY_CANDIDATE"
    | "STALE_OR_INCOMPLETE_EVIDENCE"
    | "CROSS_MODE_EVIDENCE_INCOMPLETE"
    | "WEAK_OR_UNKNOWN_TIME_EVIDENCE"
    | "HISTORICAL_ENTITLEMENT_UNPROVEN"
    | "LIVE_FIELD_CONFIRMATION_REQUIRED"
  )[];
}>;

type Edge = {
  to: number;
  reverse: number;
  capacity: number;
  cost: number;
  candidateId: string | null;
};

function required(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function version(value: string, label: string): string {
  const normalized = required(value, label);
  if (!versionPattern.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const normalized = required(value, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return normalized;
}

function addEdge(
  graph: Edge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number,
  candidateId: string | null = null,
): void {
  const forward: Edge = {
    to,
    reverse: graph[to]!.length,
    capacity,
    cost,
    candidateId,
  };
  const reverse: Edge = {
    to: from,
    reverse: graph[from]!.length,
    capacity: 0,
    cost: -cost,
    candidateId: null,
  };
  graph[from]!.push(forward);
  graph[to]!.push(reverse);
}

function maximumValueAssignments(
  ready: readonly NormalizedCandidate[],
  brackets: readonly NormalizedBracket[],
): ReadonlySet<string> {
  const coreIds = [...new Set(ready.map(({ coreId }) => coreId))].sort();
  const bracketIds = brackets.map(({ bracketId }) => bracketId).sort();
  const source = 0;
  const coreOffset = 1;
  const bracketOffset = coreOffset + coreIds.length;
  const sink = bracketOffset + bracketIds.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const coreNode = new Map(
    coreIds.map((coreId, index) => [coreId, coreOffset + index] as const),
  );
  const bracketNode = new Map(
    bracketIds.map(
      (bracketId, index) => [bracketId, bracketOffset + index] as const,
    ),
  );

  for (const coreId of coreIds)
    addEdge(graph, source, coreNode.get(coreId)!, 1, 0);
  for (const bracket of brackets) {
    addEdge(
      graph,
      bracketNode.get(bracket.bracketId)!,
      sink,
      bracket.reviewCapacity,
      0,
    );
  }
  for (const candidate of [...ready].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  )) {
    addEdge(
      graph,
      coreNode.get(candidate.coreId)!,
      bracketNode.get(candidate.bracketId)!,
      1,
      -candidate.projectedValueBasisPoints,
      candidate.candidateId,
    );
  }

  while (true) {
    const distance = Array<number>(graph.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    const queued = Array<boolean>(graph.length).fill(false);
    const queue: number[] = [source];
    distance[source] = 0;
    queued[source] = true;

    while (queue.length > 0) {
      const node = queue.shift()!;
      queued[node] = false;
      for (const [edgeIndex, edge] of graph[node]!.entries()) {
        const nextDistance = distance[node]! + edge.cost;
        if (edge.capacity <= 0 || nextDistance >= distance[edge.to]!) continue;
        distance[edge.to] = nextDistance;
        previousNode[edge.to] = node;
        previousEdge[edge.to] = edgeIndex;
        if (!queued[edge.to]) {
          queue.push(edge.to);
          queued[edge.to] = true;
        }
      }
    }

    if (previousNode[sink] === -1) break;
    for (let node = sink; node !== source; node = previousNode[node]!) {
      const edge = graph[previousNode[node]!]![previousEdge[node]!]!;
      edge.capacity -= 1;
      graph[node]![edge.reverse]!.capacity += 1;
    }
  }

  const selected = new Set<string>();
  for (const node of coreNode.values()) {
    for (const edge of graph[node]!) {
      if (edge.candidateId !== null && edge.capacity === 0) {
        selected.add(edge.candidateId);
      }
    }
  }
  return selected;
}

type NormalizedBracket = MaidenAllocationBracketInput;
type NormalizedCandidate = MaidenAllocationCandidateInput & {
  dataCurrentThrough: string | null;
  lastImported: string | null;
};

export function allocateMaidenVaultOpportunities(
  bracketInputs: readonly MaidenAllocationBracketInput[],
  candidateInputs: readonly MaidenAllocationCandidateInput[],
): MaidenVaultAllocation {
  if (bracketInputs.length === 0) {
    throw new Error("At least one Maiden allocation bracket is required.");
  }
  const brackets = bracketInputs
    .map((input): NormalizedBracket => {
      if (
        !Number.isSafeInteger(input.reviewCapacity) ||
        input.reviewCapacity < 0
      ) {
        throw new Error(
          "Maiden review capacity must be a non-negative safe integer.",
        );
      }
      if (!maidenAllocationModes.includes(input.mode)) {
        throw new Error("Maiden allocation bracket mode is invalid.");
      }
      if (!["upcoming", "qualifying", "closed"].includes(input.availability)) {
        throw new Error("Maiden bracket availability is invalid.");
      }
      if (!["confirmed", "uncertain"].includes(input.ruleStatus)) {
        throw new Error("Maiden bracket rule status is invalid.");
      }
      return {
        ...input,
        tournamentId: required(input.tournamentId, "Tournament ID"),
        tournamentLabel: required(input.tournamentLabel, "Tournament label"),
        bracketId: required(input.bracketId, "Bracket ID"),
        bracketLabel: required(input.bracketLabel, "Bracket label"),
        configurationVersion: version(
          input.configurationVersion,
          "Maiden configuration version",
        ),
        candidateSnapshotVersion: version(
          input.candidateSnapshotVersion,
          "Maiden candidate snapshot version",
        ),
        projectionVersion: version(
          input.projectionVersion,
          "Maiden projection version",
        ),
      };
    })
    .sort((left, right) => left.bracketId.localeCompare(right.bracketId));
  if (
    new Set(brackets.map(({ bracketId }) => bracketId)).size !== brackets.length
  ) {
    throw new Error("Maiden allocation bracket IDs must be unique.");
  }
  const tournamentBindings = new Map<string, string>();
  const tournamentIdsByLabel = new Map<string, string>();
  const bracketIdsByLabel = new Map<string, string>();
  for (const bracket of brackets) {
    const binding = JSON.stringify([
      bracket.tournamentLabel,
      bracket.configurationVersion,
      bracket.candidateSnapshotVersion,
      bracket.projectionVersion,
    ]);
    if (
      (tournamentBindings.has(bracket.tournamentId) &&
        tournamentBindings.get(bracket.tournamentId) !== binding) ||
      (tournamentIdsByLabel.has(bracket.tournamentLabel) &&
        tournamentIdsByLabel.get(bracket.tournamentLabel) !==
          bracket.tournamentId)
    ) {
      throw new Error("Maiden tournament labels or versions are inconsistent.");
    }
    const labelKey = JSON.stringify([
      bracket.tournamentId,
      bracket.bracketLabel,
    ]);
    if (
      bracketIdsByLabel.has(labelKey) &&
      bracketIdsByLabel.get(labelKey) !== bracket.bracketId
    ) {
      throw new Error("Maiden bracket labels are inconsistent.");
    }
    tournamentBindings.set(bracket.tournamentId, binding);
    tournamentIdsByLabel.set(bracket.tournamentLabel, bracket.tournamentId);
    bracketIdsByLabel.set(labelKey, bracket.bracketId);
  }
  const bracketById = new Map(
    brackets.map((bracket) => [bracket.bracketId, bracket] as const),
  );

  const candidates = candidateInputs
    .map((input): NormalizedCandidate => {
      const candidateId = required(input.candidateId, "Candidate ID");
      const coreId = required(input.coreId, "Core ID");
      const tournamentId = required(input.tournamentId, "Tournament ID");
      const bracketId = required(input.bracketId, "Bracket ID");
      if (!maidenAllocationModes.includes(input.mode)) {
        throw new Error("Maiden allocation mode is invalid.");
      }
      if (
        !Number.isSafeInteger(input.projectedValueBasisPoints) ||
        input.projectedValueBasisPoints <= 0 ||
        input.projectedValueBasisPoints > 10_000
      ) {
        throw new Error(
          "Projected Maiden value must be one to 10,000 basis points.",
        );
      }
      if (
        !["review_candidate", "preserve_me", "hold"].includes(input.suitability)
      ) {
        throw new Error("Maiden allocation suitability is invalid.");
      }
      if (
        ![
          "eligible",
          "planned",
          "committed",
          "consumed",
          "not_eligible",
          "unknown",
          "invalid",
        ].includes(input.lifecycleState)
      ) {
        throw new Error("Maiden allocation lifecycle state is invalid.");
      }
      if (
        !["high", "moderate", "low", "unknown"].includes(
          input.evidenceConfidence,
        )
      ) {
        throw new Error("Maiden allocation evidence confidence is invalid.");
      }
      if (
        !["current", "ageing", "stale", "unknown"].includes(input.freshness)
      ) {
        throw new Error("Maiden allocation freshness is invalid.");
      }
      if (
        !["strong", "competitive", "weak", "unknown"].includes(
          input.timeEvidence,
        )
      ) {
        throw new Error("Maiden time evidence is invalid.");
      }
      if (
        !["supports", "neutral", "conflicts", "unavailable"].includes(
          input.historicalStarSupport,
        )
      ) {
        throw new Error("Maiden historical star support is invalid.");
      }
      if (typeof input.crossModeEvidenceComplete !== "boolean") {
        throw new Error("Maiden cross-mode evidence must be Boolean.");
      }
      if (input.projectionBasis !== "time_led_chronological") {
        throw new Error("Maiden projection basis is invalid.");
      }
      const bracket = bracketById.get(bracketId);
      if (
        !bracket ||
        bracket.tournamentId !== tournamentId ||
        bracket.mode !== input.mode ||
        bracket.configurationVersion !== input.configurationVersion ||
        bracket.candidateSnapshotVersion !== input.candidateSnapshotVersion ||
        bracket.projectionVersion !== input.projectionVersion
      ) {
        throw new Error(
          "Maiden candidate must reference its exact configured tournament, bracket, mode and versions.",
        );
      }
      const dataCurrentThrough = timestamp(
        input.dataCurrentThrough,
        "Data current through",
      );
      const lastImported = timestamp(input.lastImported, "Last imported");
      if (
        dataCurrentThrough !== null &&
        lastImported !== null &&
        Date.parse(lastImported) < Date.parse(dataCurrentThrough)
      ) {
        throw new Error("Last imported cannot precede data current through.");
      }
      return {
        ...input,
        candidateId,
        coreId,
        tournamentId,
        bracketId,
        configurationVersion: version(
          input.configurationVersion,
          "Maiden configuration version",
        ),
        candidateSnapshotVersion: version(
          input.candidateSnapshotVersion,
          "Maiden candidate snapshot version",
        ),
        projectionVersion: version(
          input.projectionVersion,
          "Maiden projection version",
        ),
        dataCurrentThrough,
        lastImported,
      };
    })
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  if (
    new Set(candidates.map(({ candidateId }) => candidateId)).size !==
    candidates.length
  ) {
    throw new Error("Maiden allocation candidate IDs must be unique.");
  }
  if (
    new Set(
      candidates.map(({ coreId, bracketId }) => `${coreId}\u0000${bracketId}`),
    ).size !== candidates.length
  ) {
    throw new Error("Each core may have at most one candidate per bracket.");
  }
  const coreEvidenceBindings = new Map<string, string>();
  for (const candidate of candidates) {
    const binding = JSON.stringify([
      candidate.candidateSnapshotVersion,
      candidate.projectionVersion,
      candidate.crossModeEvidenceComplete,
    ]);
    if (
      coreEvidenceBindings.has(candidate.coreId) &&
      coreEvidenceBindings.get(candidate.coreId) !== binding
    ) {
      throw new Error("Maiden cross-mode candidate evidence is inconsistent.");
    }
    coreEvidenceBindings.set(candidate.coreId, binding);
  }

  const initialStatus = new Map<string, MaidenAllocationCandidateStatus>();
  const ready = candidates.filter((candidate) => {
    const bracket = bracketById.get(candidate.bracketId)!;
    let status: MaidenAllocationCandidateStatus | null = null;
    if (candidate.suitability === "preserve_me") status = "preserve_me";
    else if (candidate.suitability === "hold") status = "held";
    else if (candidate.lifecycleState !== "eligible") {
      status = "entitlement_unavailable";
    } else if (
      bracket.availability === "closed" ||
      bracket.ruleStatus !== "confirmed" ||
      bracket.reviewCapacity === 0
    ) {
      status = "bracket_unavailable";
    } else if (
      !["high", "moderate"].includes(candidate.evidenceConfidence) ||
      !candidate.crossModeEvidenceComplete ||
      !["strong", "competitive"].includes(candidate.timeEvidence) ||
      candidate.dataCurrentThrough === null ||
      candidate.lastImported === null ||
      !["current", "ageing"].includes(candidate.freshness)
    ) {
      status = "evidence_incomplete";
    }
    if (status !== null) initialStatus.set(candidate.candidateId, status);
    return status === null;
  });

  const selectableBrackets = brackets.filter(
    ({ availability, ruleStatus, reviewCapacity }) =>
      availability !== "closed" &&
      ruleStatus === "confirmed" &&
      reviewCapacity > 0,
  );
  const selected = maximumValueAssignments(ready, selectableBrackets);
  const selectedCoreIds = new Set(
    ready
      .filter(({ candidateId }) => selected.has(candidateId))
      .map(({ coreId }) => coreId),
  );
  const capacityUsed = new Map<string, number>();
  for (const candidate of ready) {
    if (!selected.has(candidate.candidateId)) continue;
    capacityUsed.set(
      candidate.bracketId,
      (capacityUsed.get(candidate.bracketId) ?? 0) + 1,
    );
  }

  const candidateReviews = candidates.map((candidate) => {
    let status = initialStatus.get(candidate.candidateId);
    if (status === undefined && selected.has(candidate.candidateId)) {
      status = "provisionally_allocated";
    } else if (status === undefined && selectedCoreIds.has(candidate.coreId)) {
      status = "alternative_not_selected";
    } else if (status === undefined) {
      const bracket = bracketById.get(candidate.bracketId)!;
      status =
        (capacityUsed.get(candidate.bracketId) ?? 0) >= bracket.reviewCapacity
          ? "capacity_unavailable"
          : "alternative_not_selected";
    }
    return {
      candidateId: candidate.candidateId,
      coreId: candidate.coreId,
      tournamentId: candidate.tournamentId,
      tournamentLabel: bracketById.get(candidate.bracketId)!.tournamentLabel,
      bracketId: candidate.bracketId,
      bracketLabel: bracketById.get(candidate.bracketId)!.bracketLabel,
      mode: candidate.mode,
      configurationVersion: candidate.configurationVersion,
      candidateSnapshotVersion: candidate.candidateSnapshotVersion,
      projectionVersion: candidate.projectionVersion,
      projectedValueBasisPoints: candidate.projectedValueBasisPoints,
      lifecycleState: candidate.lifecycleState,
      evidenceConfidence: candidate.evidenceConfidence,
      timeEvidence: candidate.timeEvidence,
      historicalStarSupport: candidate.historicalStarSupport,
      starUsedForAllocation: false as const,
      crossModeEvidenceComplete: candidate.crossModeEvidenceComplete,
      dataCurrentThrough: candidate.dataCurrentThrough,
      lastImported: candidate.lastImported,
      freshness: candidate.freshness,
      status,
    };
  });

  const assignments = candidateReviews
    .filter(({ status }) => status === "provisionally_allocated")
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      coreId: candidate.coreId,
      tournamentId: candidate.tournamentId,
      tournamentLabel: candidate.tournamentLabel,
      bracketId: candidate.bracketId,
      bracketLabel: candidate.bracketLabel,
      mode: candidate.mode,
      configurationVersion: candidate.configurationVersion,
      candidateSnapshotVersion: candidate.candidateSnapshotVersion,
      projectionVersion: candidate.projectionVersion,
      projectedValueBasisPoints: candidate.projectedValueBasisPoints,
    }))
    .sort(
      (left, right) =>
        left.bracketId.localeCompare(right.bracketId) ||
        left.coreId.localeCompare(right.coreId),
    );
  const warnings = new Set<MaidenVaultAllocation["warnings"][number]>([
    "GATE_C_NOT_PASSED",
    "GATE_D_NOT_PASSED",
    "HISTORICAL_ENTITLEMENT_UNPROVEN",
    "LIVE_FIELD_CONFIRMATION_REQUIRED",
  ]);
  if (candidateReviews.some(({ status }) => status === "preserve_me")) {
    warnings.add("PRESERVE_ME_PRESENT");
  }
  if (
    candidateReviews.some(({ status }) =>
      ["capacity_unavailable", "alternative_not_selected"].includes(status),
    )
  ) {
    warnings.add("UNALLOCATED_READY_CANDIDATE");
  }
  if (candidateReviews.some(({ status }) => status === "evidence_incomplete")) {
    warnings.add("STALE_OR_INCOMPLETE_EVIDENCE");
  }
  if (
    candidateReviews.some(
      ({ crossModeEvidenceComplete }) => !crossModeEvidenceComplete,
    )
  ) {
    warnings.add("CROSS_MODE_EVIDENCE_INCOMPLETE");
  }
  if (
    candidateReviews.some(({ timeEvidence }) =>
      ["weak", "unknown"].includes(timeEvidence),
    )
  ) {
    warnings.add("WEAK_OR_UNKNOWN_TIME_EVIDENCE");
  }

  return {
    assignments,
    candidates: candidateReviews,
    objective: "maximum_total_projected_value_with_one_me_per_core",
    entitlementMutationsPerformed: false,
    importedHistoricalSnapshot: true,
    liveFieldAvailable: false,
    actionableRecommendationAllowed: false,
    maidenCommitmentAllowed: false,
    automaticEntryAllowed: false,
    warnings: [...warnings],
  };
}
