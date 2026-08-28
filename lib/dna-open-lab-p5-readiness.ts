export const DNA_OPEN_LAB_P5_TECHNICAL_REQUIREMENT_IDS = Object.freeze([
  "restart_replay_idempotency",
  "partial_failure_rate_limit_recovery",
  "tier_loss_reinstatement_catch_up",
  "stale_cached_site_operation",
  "postgres_18_physical_peak_storage",
  "private_r2_footprint_cost",
  "positive_neon_headroom",
] as const);

export type DnaOpenLabP5TechnicalRequirementId =
  (typeof DNA_OPEN_LAB_P5_TECHNICAL_REQUIREMENT_IDS)[number];

export type DnaOpenLabReadinessEvidenceStatus =
  "satisfied" | "local_evidence_only" | "pending_measurement";

export type DnaOpenLabP5ReadinessEvidence = Readonly<{
  requirementId: DnaOpenLabP5TechnicalRequirementId;
  status: DnaOpenLabReadinessEvidenceStatus;
  evidenceRefs: readonly string[];
  conclusion: string;
}>;

export type DnaOpenLabP5ReadinessAssessment = Readonly<{
  technicalEvidenceComplete: boolean;
  readyForOwnerApproval: boolean;
  ownerApprovalRecorded: boolean;
  firstPersistentPrivatePreviewSyncAllowed: boolean;
  productionChangesAllowed: false;
  blockingRequirementIds: readonly DnaOpenLabP5TechnicalRequirementId[];
}>;

const evidence = (
  value: DnaOpenLabP5ReadinessEvidence,
): DnaOpenLabP5ReadinessEvidence =>
  Object.freeze({
    ...value,
    evidenceRefs: Object.freeze([...value.evidenceRefs]),
  });

/**
 * Current repository truth for the P5 gate. Local synthetic evidence is kept
 * distinct from the measured capacity/cost and connected recovery evidence
 * needed before owner approval can be requested.
 */
export const DNA_OPEN_LAB_P5_READINESS_EVIDENCE = Object.freeze([
  evidence({
    requirementId: "restart_replay_idempotency",
    status: "local_evidence_only",
    evidenceRefs: Object.freeze([
      "tests/dna-open-lab-current-state-acquisition-runner.test.ts",
      "tests/neon-dna-open-lab-current-state-acquisition-cycle.test.ts",
      "tests/dna-open-lab-r2-current-state-evidence.test.ts",
      "tests/dna-open-lab-p5-recovery-harness.test.ts",
      "tests/dna-open-lab-p5-local-recovery-adapters.test.ts",
      "tests/dna-open-lab-p5-component-recovery-executor.test.ts",
    ]),
    conclusion:
      "CAS checkpoints, immutable first-write evidence and conflict-safe replay are proven locally; connected Preview restart evidence is outstanding.",
  }),
  evidence({
    requirementId: "partial_failure_rate_limit_recovery",
    status: "local_evidence_only",
    evidenceRefs: Object.freeze([
      "tests/dna-open-lab-current-state-acquisition-cadence.test.ts",
      "tests/dna-open-lab-current-state-acquisition-runner.test.ts",
      "tests/dna-open-lab-current-state-cycle-coordinator.test.ts",
      "tests/dna-open-lab-p5-recovery-harness.test.ts",
      "tests/dna-open-lab-p5-local-recovery-adapters.test.ts",
      "tests/dna-open-lab-p5-component-recovery-executor.test.ts",
    ]),
    conclusion:
      "Rate limits, invalid payloads, API outages and partial cycles preserve last-good state locally; connected Preview recovery evidence is outstanding.",
  }),
  evidence({
    requirementId: "tier_loss_reinstatement_catch_up",
    status: "local_evidence_only",
    evidenceRefs: Object.freeze([
      "tests/dna-open-lab-last-good-publication.test.ts",
      "tests/dna-open-lab-current-state-acquisition-cadence.test.ts",
      "tests/dna-open-lab-p5-recovery-harness.test.ts",
      "tests/dna-open-lab-p5-local-recovery-adapters.test.ts",
      "tests/dna-open-lab-p5-component-recovery-executor.test.ts",
    ]),
    conclusion:
      "Eligibility loss pauses non-destructively and requires catch-up locally; connected loss/reinstatement evidence is outstanding.",
  }),
  evidence({
    requirementId: "stale_cached_site_operation",
    status: "local_evidence_only",
    evidenceRefs: Object.freeze([
      "tests/dna-open-lab-last-good-publication.test.ts",
      "tests/neon-dna-open-lab-sync-publication.test.ts",
      "tests/dna-open-lab-p5-recovery-harness.test.ts",
      "tests/dna-open-lab-p5-local-recovery-adapters.test.ts",
      "tests/dna-open-lab-p5-component-recovery-executor.test.ts",
    ]),
    conclusion:
      "Owner-scoped last-good reads remain available while sync is paused locally; protected Preview acceptance is outstanding.",
  }),
  evidence({
    requirementId: "postgres_18_physical_peak_storage",
    status: "pending_measurement",
    evidenceRefs: Object.freeze([
      "docs/DNA_OPEN_LAB_P5_CAPACITY_MEASUREMENT.md",
      "tests/dna-open-lab-p5-capacity-measurement.test.ts",
      "tests/dna-open-lab-p5-capacity-measurement-runner.test.ts",
      "tests/neon-dna-open-lab-p5-capacity-port.test.ts",
    ]),
    conclusion:
      "The API-only PostgreSQL 18 contract and least-privilege owner-relation adapter are implemented; connected heap, index, TOAST and transient-overlap evidence remains pending.",
  }),
  evidence({
    requirementId: "private_r2_footprint_cost",
    status: "pending_measurement",
    evidenceRefs: Object.freeze([
      "docs/DNA_OPEN_LAB_P5_CAPACITY_MEASUREMENT.md",
      "tests/dna-open-lab-p5-capacity-measurement.test.ts",
      "tests/dna-open-lab-p5-capacity-measurement-runner.test.ts",
      "tests/cloudflare-dna-open-lab-p5-r2-footprint-port.test.ts",
    ]),
    conclusion:
      "The private R2 footprint contract and owner-prefix-confined listing adapter are implemented; connected retained bytes, request volume and cost evidence remains pending.",
  }),
  evidence({
    requirementId: "positive_neon_headroom",
    status: "pending_measurement",
    evidenceRefs: Object.freeze([
      "docs/DNA_OPEN_LAB_P5_CAPACITY_MEASUREMENT.md",
      "tests/dna-open-lab-p5-capacity-measurement.test.ts",
      "tests/dna-open-lab-p5-capacity-measurement-runner.test.ts",
      "tests/neon-dna-open-lab-p5-capacity-port.test.ts",
    ]),
    conclusion:
      "The API-only peak-headroom rule and physical-size adapter are machine-checkable; connected evidence must still prove positive headroom below 536,870,912 bytes.",
  }),
] satisfies readonly DnaOpenLabP5ReadinessEvidence[]);

function readinessError(message: string): never {
  throw new Error(`DNA Open Lab P5 readiness: ${message}`);
}

/**
 * Evaluates only the first persistent private Preview sync gate. Production is
 * deliberately never authorised by this assessment and remains a later,
 * separate explicit owner gate.
 */
export function assessDnaOpenLabP5Readiness(input: {
  evidence: readonly DnaOpenLabP5ReadinessEvidence[];
  ownerApprovalRecorded: boolean;
}): DnaOpenLabP5ReadinessAssessment {
  const byRequirement = new Map<
    DnaOpenLabP5TechnicalRequirementId,
    DnaOpenLabP5ReadinessEvidence
  >();
  for (const entry of input.evidence) {
    if (
      !DNA_OPEN_LAB_P5_TECHNICAL_REQUIREMENT_IDS.includes(entry.requirementId)
    ) {
      readinessError(`unsupported requirement ${entry.requirementId}`);
    }
    if (byRequirement.has(entry.requirementId)) {
      readinessError(`duplicate requirement ${entry.requirementId}`);
    }
    if (
      entry.status !== "satisfied" &&
      entry.status !== "local_evidence_only" &&
      entry.status !== "pending_measurement"
    ) {
      readinessError(`${entry.requirementId} status is invalid`);
    }
    if (entry.conclusion.trim().length < 1) {
      readinessError(`${entry.requirementId} conclusion is required`);
    }
    if (
      entry.status === "satisfied" &&
      (entry.evidenceRefs.length < 1 ||
        entry.evidenceRefs.some((reference) => reference.trim().length < 1))
    ) {
      readinessError(`${entry.requirementId} requires evidence references`);
    }
    byRequirement.set(entry.requirementId, entry);
  }

  const missing = DNA_OPEN_LAB_P5_TECHNICAL_REQUIREMENT_IDS.filter(
    (requirementId) => !byRequirement.has(requirementId),
  );
  if (missing.length > 0) {
    readinessError(`missing requirements: ${missing.join(", ")}`);
  }

  const blockingRequirementIds =
    DNA_OPEN_LAB_P5_TECHNICAL_REQUIREMENT_IDS.filter(
      (requirementId) =>
        byRequirement.get(requirementId)?.status !== "satisfied",
    );
  const technicalEvidenceComplete = blockingRequirementIds.length === 0;
  if (input.ownerApprovalRecorded && !technicalEvidenceComplete) {
    readinessError("owner approval cannot precede complete technical evidence");
  }

  return Object.freeze({
    technicalEvidenceComplete,
    readyForOwnerApproval: technicalEvidenceComplete,
    ownerApprovalRecorded: input.ownerApprovalRecorded,
    firstPersistentPrivatePreviewSyncAllowed:
      technicalEvidenceComplete && input.ownerApprovalRecorded,
    productionChangesAllowed: false,
    blockingRequirementIds: Object.freeze(blockingRequirementIds),
  });
}

export const DNA_OPEN_LAB_CURRENT_P5_READINESS = assessDnaOpenLabP5Readiness({
  evidence: DNA_OPEN_LAB_P5_READINESS_EVIDENCE,
  ownerApprovalRecorded: false,
});
