import { describe, expect, it } from "vitest";

import {
  projectHostedConnectedProviderPreflight,
  type HostedConnectedProviderPreflightInput,
} from "@/domain/hosted-connected-provider-preflight";

const HEAD = "a".repeat(40);

function input(
  overrides: Partial<HostedConnectedProviderPreflightInput> = {},
): HostedConnectedProviderPreflightInput {
  return {
    evidenceId: "connected-provider-preflight",
    headSha: HEAD,
    evidenceSha256: "b".repeat(64),
    observedAt: "2026-07-26T22:15:00.000Z",
    neon: {
      projectId: "synthetic-project-id",
      previewBranchId: "synthetic-preview-branch-id",
      postgresVersion: "18.4",
      rowSecurity: "on",
      publicTableCount: 0,
      defaultBranchUntouched: true,
      readOnlyPreflight: true,
      migrationsRun: false,
      secretsAltered: false,
    },
    vercel: {
      projectAccess: "unavailable",
      observedGitBranch: "main",
      observedDeploymentTarget: "production",
      deploymentGuardResult: "blocked",
      retryHeld: true,
      allowProductionDeployment: false,
      domainAttached: false,
    },
    ownerDirection: {
      waitForVerifiedMain: true,
      exactHeadActionsFirst: true,
      productionGateStillRequired: true,
    },
    ...overrides,
  };
}

describe("hosted connected-provider preflight", () => {
  it("records the isolated read-only preflight and Vercel access limitation", () => {
    expect(projectHostedConnectedProviderPreflight(input())).toMatchObject({
      status: "recorded_with_limitations",
      previewDatabaseCapabilityVerified: true,
      vercelProjectAccessPending: true,
      check: {
        name: "connected_provider_preflight",
        state: "passed",
        headSha: HEAD,
      },
      migrationAllowed: false,
      deploymentAllowed: false,
      workflowDispatchAllowed: false,
      secretMutationAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("becomes preparation-ready only after project access is available", () => {
    const value = input();
    const result = projectHostedConnectedProviderPreflight({
      ...value,
      vercel: { ...value.vercel, projectAccess: "available" },
    });

    expect(result.status).toBe("ready_for_preview_preparation");
    expect(result.vercelProjectAccessPending).toBe(false);
    expect(result.deploymentAllowed).toBe(false);
  });

  it("blocks row-security or empty-schema drift", () => {
    const value = input();
    const result = projectHostedConnectedProviderPreflight({
      ...value,
      neon: {
        ...value.neon,
        rowSecurity: "off",
        publicTableCount: 1,
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "ROW_SECURITY_DISABLED",
        "PREVIEW_SCHEMA_NOT_EMPTY",
      ]),
    );
  });

  it("blocks Neon mutation or default-branch drift", () => {
    const value = input();
    const result = projectHostedConnectedProviderPreflight({
      ...value,
      neon: {
        ...value.neon,
        defaultBranchUntouched: false,
        readOnlyPreflight: false,
        migrationsRun: true,
        secretsAltered: true,
      },
    });

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "NEON_DEFAULT_BRANCH_TOUCHED",
        "NON_READ_ONLY_PREFLIGHT",
        "MIGRATION_EXECUTED",
        "SECRETS_ALTERED",
      ]),
    );
  });

  it("blocks Production guard or retry drift", () => {
    const value = input();
    const result = projectHostedConnectedProviderPreflight({
      ...value,
      vercel: {
        ...value.vercel,
        deploymentGuardResult: "passed",
        retryHeld: false,
        allowProductionDeployment: true,
        domainAttached: true,
      },
    });

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "PRODUCTION_GUARD_NOT_BLOCKED",
        "VERCEL_RETRY_NOT_HELD",
        "PRODUCTION_OVERRIDE_ENABLED",
        "DOMAIN_ATTACHED",
      ]),
    );
  });

  it("blocks substituted deployment observations", () => {
    const value = input();
    const result = projectHostedConnectedProviderPreflight({
      ...value,
      vercel: {
        ...value.vercel,
        observedGitBranch: "agent/example",
        observedDeploymentTarget: "preview",
      },
    });

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "UNEXPECTED_DEPLOYMENT_TARGET",
        "UNEXPECTED_GIT_BRANCH",
      ]),
    );
  });

  it("blocks owner-direction drift", () => {
    const value = input();
    const result = projectHostedConnectedProviderPreflight({
      ...value,
      ownerDirection: {
        ...value.ownerDirection,
        waitForVerifiedMain: false,
      },
    });

    expect(result.issues).toContainEqual({
      code: "OWNER_DIRECTION_MISMATCH",
      severity: "block",
    });
  });

  it("rejects malformed exact evidence and runtime booleans", () => {
    expect(() =>
      projectHostedConnectedProviderPreflight({
        ...input(),
        headSha: "not-a-sha",
      }),
    ).toThrow("40 lowercase hexadecimal");

    const value = input();
    expect(() =>
      projectHostedConnectedProviderPreflight({
        ...value,
        neon: {
          ...value.neon,
          readOnlyPreflight: "true" as unknown as boolean,
        },
      }),
    ).toThrow("explicit boolean");
  });
});
