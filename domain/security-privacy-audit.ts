export type SecurityControlCode =
  | "SINGLE_USER_AUTH_FAIL_CLOSED"
  | "OWNER_ALLOWLIST"
  | "PRIVATE_ROUTE_PROTECTION"
  | "FORCED_OWNER_RLS"
  | "PUBLIC_DATABASE_ACCESS_REVOKED"
  | "PRIVATE_OBJECT_STORAGE"
  | "NO_SECRET_CLIENT_EXPOSURE"
  | "REDACTED_LOGGING"
  | "NO_REAL_DATA_IN_GIT"
  | "NO_CRYPTO_SIGNING_SECRET_STORAGE"
  | "NO_PUBLIC_INDEXING"
  | "DEPENDENCY_AND_CONFIG_REVIEW";

export type SecurityControlEvidence = {
  control: SecurityControlCode;
  state: "verified" | "unknown" | "failed";
  evidence: string | null;
};

export type SecurityPrivacyAuditInput = {
  auditId: string;
  exactHeadSha: string;
  controls: readonly SecurityControlEvidence[];
  productionMutationRequested: boolean;
  publicExposureRequested: boolean;
  secretRequested: boolean;
  paidServiceRequested: boolean;
};

export type SecurityPrivacyCheck = {
  code: SecurityControlCode | "NON_EXPANDING_AUDIT_SCOPE";
  status: "pass" | "review" | "block";
  detail: string;
};

export type SecurityPrivacyAudit = {
  status: "verified_contract" | "review_required" | "blocked";
  checks: readonly SecurityPrivacyCheck[];
  productionReady: false;
  publicExposureAllowed: false;
  secretCollectionAllowed: false;
  gateFStatus: "client_only";
};

export const REQUIRED_SECURITY_CONTROLS: readonly SecurityControlCode[] = [
  "SINGLE_USER_AUTH_FAIL_CLOSED",
  "OWNER_ALLOWLIST",
  "PRIVATE_ROUTE_PROTECTION",
  "FORCED_OWNER_RLS",
  "PUBLIC_DATABASE_ACCESS_REVOKED",
  "PRIVATE_OBJECT_STORAGE",
  "NO_SECRET_CLIENT_EXPOSURE",
  "REDACTED_LOGGING",
  "NO_REAL_DATA_IN_GIT",
  "NO_CRYPTO_SIGNING_SECRET_STORAGE",
  "NO_PUBLIC_INDEXING",
  "DEPENDENCY_AND_CONFIG_REVIEW",
];

function check(
  code: SecurityPrivacyCheck["code"],
  status: SecurityPrivacyCheck["status"],
  detail: string,
): SecurityPrivacyCheck {
  return { code, status, detail };
}

export function auditSecurityPrivacy(
  input: SecurityPrivacyAuditInput,
): SecurityPrivacyAudit {
  if (input.auditId.trim() === "") throw new Error("Audit ID is required.");
  if (!/^[0-9a-f]{40}$/i.test(input.exactHeadSha)) {
    throw new Error("Exact-head SHA must contain 40 hexadecimal characters.");
  }

  const seen = new Set<SecurityControlCode>();
  for (const control of input.controls) {
    if (!REQUIRED_SECURITY_CONTROLS.includes(control.control)) {
      throw new Error("Security evidence contains an unsupported control.");
    }
    if (seen.has(control.control)) {
      throw new Error("Each security control must appear exactly once.");
    }
    seen.add(control.control);
    if (!["verified", "unknown", "failed"].includes(control.state)) {
      throw new Error("Security control state is invalid.");
    }
    if (
      control.state !== "unknown" &&
      (control.evidence === null || control.evidence.trim() === "")
    ) {
      throw new Error("Verified or failed controls require evidence.");
    }
  }
  if (seen.size !== REQUIRED_SECURITY_CONTROLS.length) {
    throw new Error("Every required security control must be supplied.");
  }

  const byControl = new Map(
    input.controls.map((control) => [control.control, control]),
  );
  const checks: SecurityPrivacyCheck[] = REQUIRED_SECURITY_CONTROLS.map(
    (code) => {
      const control = byControl.get(code);
      if (!control) throw new Error("Required security control is missing.");
      return check(
        code,
        control.state === "verified"
          ? "pass"
          : control.state === "failed"
            ? "block"
            : "review",
        control.evidence ??
          "Evidence is unknown and must be resolved before readiness.",
      );
    },
  );

  checks.push(
    check(
      "NON_EXPANDING_AUDIT_SCOPE",
      input.productionMutationRequested ||
        input.publicExposureRequested ||
        input.secretRequested ||
        input.paidServiceRequested
        ? "block"
        : "pass",
      "The audit cannot mutate Production, expose routes, collect secrets or enable paid services.",
    ),
  );

  return {
    status: checks.some((item) => item.status === "block")
      ? "blocked"
      : checks.some((item) => item.status === "review")
        ? "review_required"
        : "verified_contract",
    checks,
    productionReady: false,
    publicExposureAllowed: false,
    secretCollectionAllowed: false,
    gateFStatus: "client_only",
  };
}
