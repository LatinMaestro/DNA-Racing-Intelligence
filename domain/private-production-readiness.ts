export type ReadinessEvidenceState = "passed" | "not_run" | "failed";
export type ReviewGateEvidenceState = "accepted" | "not_accepted" | "blocked";

export type PrivateProductionReadinessInput = {
  assessmentId: string;
  exactHeadSha: string;
  gates: {
    gateA: ReviewGateEvidenceState;
    gateB: ReviewGateEvidenceState;
    gateC: ReviewGateEvidenceState;
    gateD: ReviewGateEvidenceState;
    gateE: ReviewGateEvidenceState;
  };
  exactHeadCi: ReadinessEvidenceState;
  representativePrivateImport: ReadinessEvidenceState;
  recoveryValidation: ReadinessEvidenceState;
  performanceCapacity: ReadinessEvidenceState;
  securityPrivacy: ReadinessEvidenceState;
  accessibilityResponsive: ReadinessEvidenceState;
  migrations: "reversible_verified" | "not_verified" | "irreversible";
  knownLimitationsDocumented: boolean;
  productionDisabled: boolean;
  customDomainAttached: boolean;
  publicRoutesExposed: boolean;
  fullPrivateDataInProduction: boolean;
  recurringPaidInfrastructureEnabled: boolean;
  ownerGateFApproval: boolean;
  activationRequested: boolean;
};

export type ProductionReadinessCheck = {
  code:
    | "GATES_A_TO_E"
    | "EXACT_HEAD_CI"
    | "REPRESENTATIVE_PRIVATE_IMPORT"
    | "RECOVERY_VALIDATION"
    | "PERFORMANCE_CAPACITY"
    | "SECURITY_PRIVACY"
    | "ACCESSIBILITY_RESPONSIVE"
    | "MIGRATION_SAFETY"
    | "KNOWN_LIMITATIONS"
    | "PRODUCTION_FAIL_CLOSED"
    | "GATE_F_OWNER_APPROVAL"
    | "NON_EXECUTABLE_ASSESSMENT";
  status: "pass" | "review" | "block";
  detail: string;
};

export type PrivateProductionReadiness = {
  status:
    | "blocked"
    | "review_required"
    | "ready_for_gate_f_review"
    | "gate_f_approval_recorded";
  checks: readonly ProductionReadinessCheck[];
  activationAuthorized: false;
  productionMutationAllowed: false;
  gateFStatus: "client_only";
};

function evidenceStatus(
  state: ReadinessEvidenceState,
): ProductionReadinessCheck["status"] {
  if (state === "passed") return "pass";
  return state === "failed" ? "block" : "review";
}

export function assessPrivateProductionReadiness(
  input: PrivateProductionReadinessInput,
): PrivateProductionReadiness {
  if (input.assessmentId.trim() === "") {
    throw new Error("Assessment ID is required.");
  }
  if (!/^[0-9a-f]{40}$/i.test(input.exactHeadSha)) {
    throw new Error("Exact-head SHA must contain 40 hexadecimal characters.");
  }
  const checks: ProductionReadinessCheck[] = [
    {
      code: "GATES_A_TO_E",
      status: Object.values(input.gates).some((state) => state === "blocked")
        ? "block"
        : Object.values(input.gates).every((state) => state === "accepted")
          ? "pass"
          : "review",
      detail: "Every evidence gate from A to E must be accepted.",
    },
    {
      code: "EXACT_HEAD_CI",
      status: evidenceStatus(input.exactHeadCi),
      detail: "Complete CI must pass against the exact assessed head.",
    },
    {
      code: "REPRESENTATIVE_PRIVATE_IMPORT",
      status: evidenceStatus(input.representativePrivateImport),
      detail:
        "A representative private Preview import must pass without exposing source rows.",
    },
    {
      code: "RECOVERY_VALIDATION",
      status: evidenceStatus(input.recoveryValidation),
      detail:
        "Replay, rollback and aggregate-recovery evidence must pass for the assessed head.",
    },
    {
      code: "PERFORMANCE_CAPACITY",
      status: evidenceStatus(input.performanceCapacity),
      detail:
        "Bounded-memory processing, provider capacity and routine-request performance must pass.",
    },
    {
      code: "SECURITY_PRIVACY",
      status: evidenceStatus(input.securityPrivacy),
      detail:
        "Owner isolation, privacy scans, secret handling and fail-closed provider boundaries must pass.",
    },
    {
      code: "ACCESSIBILITY_RESPONSIVE",
      status: evidenceStatus(input.accessibilityResponsive),
      detail:
        "Authenticated workflows must pass keyboard, screen-reader and responsive review.",
    },
    {
      code: "MIGRATION_SAFETY",
      status:
        input.migrations === "reversible_verified"
          ? "pass"
          : input.migrations === "irreversible"
            ? "block"
            : "review",
      detail:
        "PostgreSQL migrations must be applied, smoke-tested and reversibly verified.",
    },
    {
      code: "KNOWN_LIMITATIONS",
      status: input.knownLimitationsDocumented ? "pass" : "review",
      detail:
        "Known limitations and unavailable evidence must remain explicit.",
    },
    {
      code: "PRODUCTION_FAIL_CLOSED",
      status:
        input.productionDisabled &&
        !input.customDomainAttached &&
        !input.publicRoutesExposed &&
        !input.fullPrivateDataInProduction &&
        !input.recurringPaidInfrastructureEnabled
          ? "pass"
          : "block",
      detail: "Production must remain fail-closed.",
    },
    {
      code: "GATE_F_OWNER_APPROVAL",
      status: input.ownerGateFApproval ? "pass" : "review",
      detail: "Gate F remains client-only.",
    },
    {
      code: "NON_EXECUTABLE_ASSESSMENT",
      status: input.activationRequested ? "block" : "pass",
      detail: "Assessment cannot activate Production.",
    },
  ];
  const technicalChecks = checks.filter(
    ({ code }) =>
      code !== "GATE_F_OWNER_APPROVAL" && code !== "NON_EXECUTABLE_ASSESSMENT",
  );
  const hasBlocker = checks.some(({ status }) => status === "block");
  const technicalEvidencePassed = technicalChecks.every(
    ({ status }) => status === "pass",
  );

  return {
    status: hasBlocker
      ? "blocked"
      : technicalEvidencePassed
        ? input.ownerGateFApproval
          ? "gate_f_approval_recorded"
          : "ready_for_gate_f_review"
        : "review_required",
    checks,
    activationAuthorized: false,
    productionMutationAllowed: false,
    gateFStatus: "client_only",
  };
}
