import { describe, expect, it } from "vitest";

import {
  projectHostedSecurityAttestations,
  type HostedSecurityAttestationInput,
  type HostedSecurityControlAttestation,
} from "@/domain/hosted-security-attestation";

const HEAD = "a".repeat(40);
const ROUTES = "b".repeat(64);
const CONFIGURATION = "c".repeat(64);
const PROVIDERS = "d".repeat(64);
const SUMMARY = "e".repeat(64);

const commands = {
  single_user_auth_fail_closed: "security_verify_single_user_auth",
  owner_allowlist: "security_verify_owner_allowlist",
  private_route_protection: "security_verify_private_routes",
  forced_owner_rls: "security_verify_forced_owner_rls",
  public_database_access_revoked: "security_verify_public_db_revoked",
  private_object_storage: "security_verify_private_object_storage",
  no_secret_client_exposure: "security_verify_client_secret_boundary",
  redacted_logging: "security_verify_log_redaction",
  no_real_data_in_git: "security_verify_repository_privacy",
  no_crypto_signing_secret_storage: "security_verify_no_signing_secrets",
  no_public_indexing: "security_verify_no_indexing",
  dependency_and_config_review: "security_verify_dependencies_and_config",
} as const;

function attestations(): HostedSecurityControlAttestation[] {
  return Object.entries(commands).map(([control, commandId], index) => ({
    attestationId: `security-${index + 1}`,
    control: control as HostedSecurityControlAttestation["control"],
    commandId,
    headSha: HEAD,
    routeManifestSha256: ROUTES,
    configurationManifestSha256: CONFIGURATION,
    providerContractSha256: PROVIDERS,
    startedAt: "2026-07-26T12:00:00.000Z",
    completedAt: "2026-07-26T12:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 12,
    assertionsTotal: 12,
    redactedSummaryOnly: true,
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
    ownerIsolationVerified: [
      "single_user_auth_fail_closed",
      "owner_allowlist",
      "private_route_protection",
      "forced_owner_rls",
    ].includes(control),
    publicAccessDenied: [
      "public_database_access_revoked",
      "private_object_storage",
      "no_public_indexing",
    ].includes(control),
    clientSecretExposureDetected: false,
    loggingRedactionVerified: control === "redacted_logging",
    repositoryPrivacyVerified: control === "no_real_data_in_git",
    dependencyReviewComplete: control === "dependency_and_config_review",
    connectedProviderEvidence: [
      "forced_owner_rls",
      "public_database_access_revoked",
      "private_object_storage",
    ].includes(control),
  }));
}

function input(
  overrides: Partial<HostedSecurityAttestationInput> = {},
): HostedSecurityAttestationInput {
  return {
    evidenceId: "hosted-security-attestations",
    composedHeadSha: HEAD,
    routeManifestSha256: ROUTES,
    configurationManifestSha256: CONFIGURATION,
    providerContractSha256: PROVIDERS,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted security attestations", () => {
  it("projects complete exact-head security evidence without authority", () => {
    expect(projectHostedSecurityAttestations(input())).toMatchObject({
      status: "attested",
      passedControls: Object.keys(commands),
      check: { name: "security_privacy", state: "passed", headSha: HEAD },
      issues: [],
      privateArtifactsRetained: false,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      productionMutationAllowed: false,
      publicExposureAllowed: false,
      secretCollectionAllowed: false,
      paidServiceActivationAllowed: false,
    });
  });

  it("keeps a missing required control review-required", () => {
    const result = projectHostedSecurityAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "CONTROL_MISSING",
      control: "single_user_auth_fail_closed",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "f".repeat(40),
      commandId: "security_verify_owner_allowlist",
      routeManifestSha256: "0".repeat(64),
      configurationManifestSha256: "1".repeat(64),
      providerContractSha256: "2".repeat(64),
    };
    const result = projectHostedSecurityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "CONTROL_STALE",
        "COMMAND_MISMATCH",
        "ROUTE_MANIFEST_MISMATCH",
        "CONFIGURATION_MANIFEST_MISMATCH",
        "PROVIDER_CONTRACT_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete or unsafe evidence", () => {
    const values = attestations();
    values[6] = {
      ...values[6]!,
      exitCode: 1,
      assertionsPassed: 11,
      redactedSummaryOnly: false,
      syntheticFixturesOnly: false,
      privateDataObserved: true,
      retainedPrivateArtifact: true,
      clientSecretExposureDetected: true,
    };
    const result = projectHostedSecurityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "UNREDACTED_SUMMARY",
        "NON_SYNTHETIC_FIXTURE",
        "PRIVATE_DATA_OBSERVED",
        "PRIVATE_ARTIFACT_RETAINED",
        "CLIENT_SECRET_EXPOSURE",
      ]),
    );
  });

  it("requires owner isolation and denied public access", () => {
    const values = attestations();
    values[3] = { ...values[3]!, ownerIsolationVerified: false };
    values[4] = { ...values[4]!, publicAccessDenied: false };
    const result = projectHostedSecurityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "OWNER_ISOLATION_UNVERIFIED",
        "PUBLIC_ACCESS_NOT_DENIED",
      ]),
    );
  });

  it("requires connected evidence for provider-backed controls", () => {
    const values = attestations();
    values[3] = { ...values[3]!, connectedProviderEvidence: false };
    values[4] = { ...values[4]!, connectedProviderEvidence: false };
    values[5] = { ...values[5]!, connectedProviderEvidence: false };
    const result = projectHostedSecurityAttestations(
      input({ attestations: values }),
    );

    expect(
      result.issues.filter(
        ({ code }) => code === "PROVIDER_EVIDENCE_UNCONNECTED",
      ),
    ).toHaveLength(3);
  });

  it("requires logging, repository and dependency evidence", () => {
    const values = attestations();
    values[7] = { ...values[7]!, loggingRedactionVerified: false };
    values[8] = { ...values[8]!, repositoryPrivacyVerified: false };
    values[11] = { ...values[11]!, dependencyReviewComplete: false };
    const result = projectHostedSecurityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "LOG_REDACTION_UNVERIFIED",
        "REPOSITORY_PRIVACY_UNVERIFIED",
        "DEPENDENCY_REVIEW_INCOMPLETE",
      ]),
    );
  });

  it("blocks inverted execution times", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      startedAt: "2026-07-26T12:02:00.000Z",
    };
    const result = projectHostedSecurityAttestations(
      input({ attestations: values }),
    );

    expect(result.issues).toContainEqual({
      code: "INVALID_TIME_ORDER",
      control: "private_route_protection",
      severity: "block",
    });
  });

  it("rejects duplicates and malformed runtime facts", () => {
    const values = attestations();
    expect(() =>
      projectHostedSecurityAttestations(
        input({ attestations: [...values, values[0]!] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      projectHostedSecurityAttestations(
        input({
          attestations: [
            {
              ...values[0]!,
              redactedSummaryOnly: "true" as unknown as boolean,
            },
          ],
        }),
      ),
    ).toThrow("explicit boolean");
    expect(() =>
      projectHostedSecurityAttestations(
        input({
          attestations: [{ ...values[0]!, assertionsTotal: 0 }],
        }),
      ),
    ).toThrow("positive safe integer");
  });
});
