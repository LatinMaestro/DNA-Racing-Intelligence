import { describe, expect, it } from "vitest";

import {
  projectHostedAccessibilityAttestations,
  type HostedAccessibilityAttestationInput,
  type HostedAccessibilityScopeAttestation,
} from "@/domain/hosted-accessibility-attestation";

const HEAD = "a".repeat(40);
const ROUTES = "b".repeat(64);
const SUMMARY = "c".repeat(64);

const commands = {
  semantic_structure: "accessibility_check_semantic_structure",
  keyboard_navigation: "accessibility_check_keyboard_navigation",
  focus_management: "accessibility_check_focus_management",
  assistive_technology: "accessibility_check_assistive_technology",
  visual_contrast_and_status: "accessibility_check_visual_contrast_and_status",
  responsive_reflow: "accessibility_check_responsive_reflow",
} as const;

function attestations(): HostedAccessibilityScopeAttestation[] {
  return Object.entries(commands).map(([scope, commandId], index) => ({
    attestationId: `accessibility-${index + 1}`,
    scope: scope as HostedAccessibilityScopeAttestation["scope"],
    commandId,
    headSha: HEAD,
    routeManifestSha256: ROUTES,
    startedAt: "2026-07-26T10:00:00.000Z",
    completedAt: "2026-07-26T10:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    routesCovered: 10,
    checkpointsCovered: 12,
    automatedViolationsCount: 0,
    manualFindingsCount: 0,
    coverageComplete: true,
    manualReviewComplete: true,
    authenticatedOwnerWorkspace: true,
    syntheticPrivateStateOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
  }));
}

function input(
  overrides: Partial<HostedAccessibilityAttestationInput> = {},
): HostedAccessibilityAttestationInput {
  return {
    evidenceId: "hosted-accessibility-attestations",
    composedHeadSha: HEAD,
    routeManifestSha256: ROUTES,
    wcagTarget: "WCAG_2_2_AA",
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted accessibility attestations", () => {
  it("projects complete exact-head evidence without delivery authority", () => {
    expect(projectHostedAccessibilityAttestations(input())).toMatchObject({
      status: "attested",
      passedScopes: Object.keys(commands),
      issues: [],
      wcagTarget: "WCAG_2_2_AA",
      privateArtifactsRetained: false,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("keeps a missing required scope review-required", () => {
    const result = projectHostedAccessibilityAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result.status).toBe("review_required");
    expect(result.issues).toContainEqual({
      code: "SCOPE_MISSING",
      scope: "semantic_structure",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and route drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "d".repeat(40),
      commandId: "accessibility_check_keyboard_navigation",
      routeManifestSha256: "e".repeat(64),
    };
    const result = projectHostedAccessibilityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SCOPE_STALE",
        "COMMAND_MISMATCH",
        "ROUTE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete and finding-bearing evidence", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      coverageComplete: false,
      manualReviewComplete: false,
      automatedViolationsCount: 2,
      manualFindingsCount: 1,
    };
    const result = projectHostedAccessibilityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "COVERAGE_INCOMPLETE",
        "MANUAL_REVIEW_INCOMPLETE",
        "AUTOMATED_VIOLATION",
        "MANUAL_FINDING",
      ]),
    );
  });

  it("blocks unverified owner context and non-synthetic private state", () => {
    const values = attestations();
    values[3] = {
      ...values[3]!,
      authenticatedOwnerWorkspace: false,
      syntheticPrivateStateOnly: false,
    };
    const result = projectHostedAccessibilityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "NON_OWNER_WORKSPACE",
        "NON_SYNTHETIC_PRIVATE_STATE",
      ]),
    );
  });

  it("blocks observed or retained private material", () => {
    const values = attestations();
    values[4] = {
      ...values[4]!,
      privateDataObserved: true,
      retainedPrivateArtifact: true,
    };
    const result = projectHostedAccessibilityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "PRIVATE_DATA_OBSERVED",
        "PRIVATE_ARTIFACT_RETAINED",
      ]),
    );
  });

  it("blocks inverted execution times", () => {
    const values = attestations();
    values[5] = {
      ...values[5]!,
      startedAt: "2026-07-26T10:02:00.000Z",
    };
    const result = projectHostedAccessibilityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues).toContainEqual({
      code: "INVALID_TIME_ORDER",
      scope: "responsive_reflow",
      severity: "block",
    });
  });

  it("rejects duplicates and malformed runtime facts", () => {
    const values = attestations();
    expect(() =>
      projectHostedAccessibilityAttestations(
        input({ attestations: [...values, values[0]!] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      projectHostedAccessibilityAttestations(
        input({
          attestations: [
            {
              ...values[0]!,
              manualReviewComplete: "true" as unknown as boolean,
            },
          ],
        }),
      ),
    ).toThrow("explicit boolean");
    expect(() =>
      projectHostedAccessibilityAttestations(
        input({
          attestations: [
            {
              ...values[0]!,
              routesCovered: 0,
            },
          ],
        }),
      ),
    ).toThrow("positive safe integer");
  });

  it("rejects an unsupported WCAG target", () => {
    expect(() =>
      projectHostedAccessibilityAttestations(
        input({
          wcagTarget:
            "WCAG_2_1_AA" as HostedAccessibilityAttestationInput["wcagTarget"],
        }),
      ),
    ).toThrow("WCAG target");
  });
});
