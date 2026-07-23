import { describe, expect, it } from "vitest";
import {
  auditSecurityPrivacy,
  REQUIRED_SECURITY_CONTROLS,
  type SecurityControlEvidence,
  type SecurityPrivacyAuditInput,
} from "@/domain/security-privacy-audit";

function controls(
  overrides: Partial<
    Record<SecurityControlEvidence["control"], SecurityControlEvidence["state"]>
  > = {},
): SecurityControlEvidence[] {
  return REQUIRED_SECURITY_CONTROLS.map((control) => ({
    control,
    state: overrides[control] ?? "verified",
    evidence:
      overrides[control] === "unknown"
        ? null
        : `Synthetic audit evidence for ${control}.`,
  }));
}

function input(
  overrides: Partial<SecurityPrivacyAuditInput> = {},
): SecurityPrivacyAuditInput {
  return {
    auditId: "security-2026-07-24",
    exactHeadSha: "b".repeat(40),
    controls: controls(),
    productionMutationRequested: false,
    publicExposureRequested: false,
    secretRequested: false,
    paidServiceRequested: false,
    ...overrides,
  };
}

describe("Phase 9 security and privacy audit", () => {
  it("verifies a complete control-evidence contract", () => {
    const audit = auditSecurityPrivacy(input());

    expect(audit.status).toBe("verified_contract");
    expect(audit.checks.every((item) => item.status === "pass")).toBe(true);
    expect(audit).toMatchObject({
      productionReady: false,
      publicExposureAllowed: false,
      secretCollectionAllowed: false,
      gateFStatus: "client_only",
    });
  });

  it("keeps an unknown control review-required", () => {
    const audit = auditSecurityPrivacy(
      input({
        controls: controls({ DEPENDENCY_AND_CONFIG_REVIEW: "unknown" }),
      }),
    );

    expect(audit.status).toBe("review_required");
    expect(
      audit.checks.find((item) => item.code === "DEPENDENCY_AND_CONFIG_REVIEW"),
    ).toMatchObject({ status: "review" });
  });

  it("blocks a failed access or isolation control", () => {
    const audit = auditSecurityPrivacy(
      input({ controls: controls({ FORCED_OWNER_RLS: "failed" }) }),
    );

    expect(audit.status).toBe("blocked");
    expect(
      audit.checks.find((item) => item.code === "FORCED_OWNER_RLS"),
    ).toMatchObject({ status: "block" });
  });

  it("blocks scope expansion during an audit", () => {
    const audit = auditSecurityPrivacy(
      input({
        productionMutationRequested: true,
        publicExposureRequested: true,
        secretRequested: true,
        paidServiceRequested: true,
      }),
    );

    expect(audit.status).toBe("blocked");
    expect(
      audit.checks.find((item) => item.code === "NON_EXPANDING_AUDIT_SCOPE"),
    ).toMatchObject({ status: "block" });
  });

  it("requires every mandatory control exactly once", () => {
    expect(() =>
      auditSecurityPrivacy(input({ controls: controls().slice(1) })),
    ).toThrow(/Every required/);

    expect(() =>
      auditSecurityPrivacy(
        input({ controls: [...controls(), controls()[0]!] }),
      ),
    ).toThrow(/exactly once/);
  });

  it("requires evidence for verified and failed controls", () => {
    const missingEvidence = controls();
    missingEvidence[0] = { ...missingEvidence[0]!, evidence: null };

    expect(() =>
      auditSecurityPrivacy(input({ controls: missingEvidence })),
    ).toThrow(/require evidence/);
  });

  it("allows unknown evidence to remain explicitly absent", () => {
    const audit = auditSecurityPrivacy(
      input({
        controls: controls({ PRIVATE_OBJECT_STORAGE: "unknown" }),
      }),
    );
    expect(audit.status).toBe("review_required");
  });

  it("rejects a non-exact repository head", () => {
    expect(() => auditSecurityPrivacy(input({ exactHeadSha: "main" }))).toThrow(
      /40 hexadecimal/,
    );
  });

  it("rejects an unsupported runtime control state", () => {
    const invalid = controls();
    invalid[0] = {
      ...invalid[0]!,
      state: "unsupported" as SecurityControlEvidence["state"],
    };

    expect(() => auditSecurityPrivacy(input({ controls: invalid }))).toThrow(
      /state is invalid/,
    );
  });
});
