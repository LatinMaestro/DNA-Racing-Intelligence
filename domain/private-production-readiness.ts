export type ReadinessEvidenceState = "passed" | "not_run" | "failed";
export type ReviewGateEvidenceState = "accepted" | "not_accepted" | "blocked";

export type PrivateProductionReadinessInput = {
  assessmentId: string;
  assessmentVersion: string;
  assessedAt: string;
  evidenceCurrentThrough: string;
  evidenceFreshness: "current" | "ageing" | "stale";
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
    | "EVIDENCE_FRESHNESS"
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

function check(
  code: ProductionReadinessCheck["code"],
  status: ProductionReadinessCheck["status"],
  detail: string,
): ProductionReadinessCheck {
  return { code, status, detail };
}

function evidenceCheck(
  code: ProductionReadinessCheck["code"],
  state: ReadinessEvidenceState,
  detail: string,
): ProductionReadinessCheck {
  return check(
    code,
    state === "passed" ? "pass" : state === "failed" ? "block" : "review",
    detail,
  );
}

export function assessPrivateProductionReadiness(
  input: PrivateProductionReadinessInput,
): PrivateProductionReadiness {
  if (input === null || typeof input !== "object") {
    throw new Error("Readiness assessment is invalid.");
  }
  if (input.assessmentId.trim() === "") {
    throw new Error("Assessment ID is required.");
  }
  if (!/^[0-9a-f]{40}$/i.test(input.exactHeadSha)) {
    throw new Error("Exact-head SHA must contain 40 hexadecimal characters.");
  }
  if (input.assessmentVersion.trim() === "") {
    throw new Error("Assessment version is required.");
  }
  for (const [value, label] of [
    [input.assessedAt, "Assessment time"],
    [input.evidenceCurrentThrough, "Evidence current through"],
  ] as const) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      throw new Error(`${label} must be a canonical UTC timestamp.`);
    }
  }
  if (input.evidenceCurrentThrough > input.assessedAt) {
    throw new Error("Readiness evidence cannot postdate its assessment.");
  }
  if (!["current", "ageing", "stale"].includes(input.evidenceFreshness)) {
    throw new Error("Readiness evidence freshness is invalid.");
  }

  if (input.gates === null || typeof input.gates !== "object") {
    throw new Error("Review-gate evidence is required.");
  }
  const gateStates = Object.values(input.gates);
  if (
    gateStates.some(
      (state) => !["accepted", "not_accepted", "blocked"].includes(state),
    )
  ) {
    throw new Error("Review-gate evidence state is invalid.");
  }
  const operationalStates = [
    input.exactHeadCi,
    input.representativePrivateImport,
    input.recoveryValidation,
    input.performanceCapacity,
    input.securityPrivacy,
    input.accessibilityResponsive,
  ];
  if (
    operationalStates.some(
      (state) => !["passed", "not_run", "failed"].includes(state),
    )
  ) {
    throw new Error("Operational readiness evidence state is invalid.");
  }
  if (
    !["reversible_verified", "not_verified", "irreversible"].includes(
      input.migrations,
    )
  ) {
    throw new Error("Migration readiness state is invalid.");
  }
  const checks: ProductionReadinessCheck[] = [
    check(
      "EVIDENCE_FRESHNESS",
      input.evidenceFreshness === "current" ? "pass" : "review",
      "Readiness evidence must remain current at the server-derived assessment boundary.",
    ),
    check(
      "GATES_A_TO_E",
      gateStates.some((state) => state === "blocked")
        ? "block"
        : gateStates.every((state) => state === "accepted")
          ? "pass"
          : "review",
      "Every evidence gate from A to E must be accepted before Gate F review.",
    ),
    evidenceCheck(
      "EXACT_HEAD_CI",
      input.exactHeadCi,
      "Complete CI must pass against the exact assessed repository head.",
    ),
    evidenceCheck(
      "REPRESENTATIVE_PRIVATE_IMPORT",
      input.representativePrivateImport,
      "A representative private import must pass its approved protected-environment controls.",
    ),
    evidenceCheck(
      "RECOVERY_VALIDATION",
      input.recoveryValidation,
      "Import rollback, replay and aggregate recovery evidence must pass.",
    ),
    evidenceCheck(
      "PERFORMANCE_CAPACITY",
      input.performanceCapacity,
      "Representative large-history latency and resource evidence must pass.",
    ),
    evidenceCheck(
      "SECURITY_PRIVACY",
      input.securityPrivacy,
      "The exact-head security and privacy audit must pass.",
    ),
    evidenceCheck(
      "ACCESSIBILITY_RESPONSIVE",
      input.accessibilityResponsive,
      "Applicable private workflows require accessibility and responsive evidence.",
    ),
    check(
      "MIGRATION_SAFETY",
      input.migrations === "reversible_verified"
        ? "pass"
        : input.migrations === "irreversible"
          ? "block"
          : "review",
      "Applicable database migrations must be reviewed and reversibly verified.",
    ),
    check(
      "KNOWN_LIMITATIONS",
      input.knownLimitationsDocumented ? "pass" : "review",
      "Known limitations and deferred items must be documented.",
    ),
  ];

  const failClosed =
    input.productionDisabled &&
    !input.customDomainAttached &&
    !input.publicRoutesExposed &&
    !input.fullPrivateDataInProduction &&
    !input.recurringPaidInfrastructureEnabled;
  checks.push(
    check(
      "PRODUCTION_FAIL_CLOSED",
      failClosed ? "pass" : "block",
      "Production must remain disabled with no domain, public routes, full private data or recurring paid infrastructure.",
    ),
  );
  checks.push(
    check(
      "GATE_F_OWNER_APPROVAL",
      input.ownerGateFApproval ? "pass" : "review",
      "Gate F requires explicit owner approval and remains client-only.",
    ),
  );
  checks.push(
    check(
      "NON_EXECUTABLE_ASSESSMENT",
      input.activationRequested ? "block" : "pass",
      "This assessment records evidence only and cannot activate or mutate Production.",
    ),
  );

  const nonGateFChecks = checks.filter(
    (item) => item.code !== "GATE_F_OWNER_APPROVAL",
  );
  const status = checks.some((item) => item.status === "block")
    ? "blocked"
    : nonGateFChecks.some((item) => item.status === "review")
      ? "review_required"
      : input.ownerGateFApproval
        ? "gate_f_approval_recorded"
        : "ready_for_gate_f_review";

  return {
    status,
    checks,
    activationAuthorized: false,
    productionMutationAllowed: false,
    gateFStatus: "client_only",
  };
}
