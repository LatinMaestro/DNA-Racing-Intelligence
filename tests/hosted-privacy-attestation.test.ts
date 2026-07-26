import { describe, expect, it } from "vitest";

import {
  projectHostedPrivacyAttestations,
  type HostedPrivacyAttestationInput,
  type HostedPrivacyScopeAttestation,
} from "@/domain/hosted-privacy-attestation";

const HEAD = "a".repeat(40);
const SCOPE_DIGEST = "b".repeat(64);
const SUMMARY_DIGEST = "c".repeat(64);

const commands = {
  current_tree: "privacy_scan_current_tree",
  candidate_diff: "privacy_scan_candidate_diff",
  reachable_history: "privacy_scan_reachable_history",
  synthetic_fixtures: "privacy_verify_synthetic_fixtures",
  retained_outputs: "privacy_scan_retained_outputs",
} as const;

function attestations(): HostedPrivacyScopeAttestation[] {
  return Object.entries(commands).map(([scope, commandId], index) => ({
    attestationId: `privacy-${index + 1}`,
    scope: scope as HostedPrivacyScopeAttestation["scope"],
    commandId,
    headSha: HEAD,
    startedAt: "2026-07-26T09:00:00.000Z",
    completedAt: "2026-07-26T09:01:00.000Z",
    exitCode: 0,
    scopeSha256: SCOPE_DIGEST,
    summarySha256: SUMMARY_DIGEST,
    findingsCount: 0,
    coverageComplete: true,
    redactedSummaryOnly: true,
    privateDataObserved: false,
    privateArtifactsRetained: false,
    syntheticFixturesOnly: scope === "synthetic_fixtures",
  }));
}

function input(
  overrides: Partial<HostedPrivacyAttestationInput> = {},
): HostedPrivacyAttestationInput {
  return {
    evidenceId: "hosted-privacy-attestations",
    composedHeadSha: HEAD,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted privacy attestations", () => {
  it("projects complete exact-head privacy evidence without authority", () => {
    expect(projectHostedPrivacyAttestations(input())).toMatchObject({
      status: "attested",
      check: { name: "privacy_scan", state: "passed", headSha: HEAD },
      issues: [],
      privateArtifactsRetained: false,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("keeps a missing required scope review-required", () => {
    const result = projectHostedPrivacyAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "SCOPE_MISSING",
      scope: "current_tree",
      severity: "review",
    });
  });

  it("blocks stale heads and command substitution", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "d".repeat(40),
      commandId: "privacy_scan_candidate_diff",
    };
    const result = projectHostedPrivacyAttestations(
      input({ attestations: values }),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["SCOPE_STALE", "COMMAND_MISMATCH"]),
    );
  });

  it("blocks failed, incomplete or non-zero-finding scans", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      coverageComplete: false,
      findingsCount: 2,
    };
    const result = projectHostedPrivacyAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SCAN_FAILED",
        "SCOPE_INCOMPLETE",
        "FINDINGS_PRESENT",
      ]),
    );
  });

  it("blocks unredacted, observed or retained private material", () => {
    const values = attestations();
    values[4] = {
      ...values[4]!,
      redactedSummaryOnly: false,
      privateDataObserved: true,
      privateArtifactsRetained: true,
    };
    const result = projectHostedPrivacyAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "UNREDACTED_SUMMARY",
        "PRIVATE_DATA_OBSERVED",
        "PRIVATE_ARTIFACT_RETAINED",
      ]),
    );
  });

  it("requires fixture provenance to remain synthetic-only", () => {
    const values = attestations();
    values[3] = { ...values[3]!, syntheticFixturesOnly: false };
    const result = projectHostedPrivacyAttestations(
      input({ attestations: values }),
    );

    expect(result.issues).toContainEqual({
      code: "NON_SYNTHETIC_FIXTURE",
      scope: "synthetic_fixtures",
      severity: "block",
    });
  });

  it("blocks inverted execution times", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      startedAt: "2026-07-26T09:02:00.000Z",
    };
    const result = projectHostedPrivacyAttestations(
      input({ attestations: values }),
    );

    expect(result.issues).toContainEqual({
      code: "INVALID_TIME_ORDER",
      scope: "reachable_history",
      severity: "block",
    });
  });

  it("rejects duplicates and malformed runtime facts", () => {
    const values = attestations();
    expect(() =>
      projectHostedPrivacyAttestations(
        input({ attestations: [...values, values[0]!] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      projectHostedPrivacyAttestations(
        input({
          attestations: [
            {
              ...values[0]!,
              coverageComplete: "true" as unknown as boolean,
            },
          ],
        }),
      ),
    ).toThrow("explicit boolean");
    expect(() =>
      projectHostedPrivacyAttestations(
        input({
          attestations: [
            {
              ...values[0]!,
              findingsCount: -1,
            },
          ],
        }),
      ),
    ).toThrow("findings count");
  });
});
