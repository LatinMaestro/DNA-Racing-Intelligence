import { describe, expect, it } from "vitest";

import {
  evaluateLocalExecutorHeartbeatControl,
  localExecutorHeartbeatProtocolVersion,
  parseLocalExecutorHeartbeat,
} from "@/domain/race-entry-bot";

const evaluatedAt = "2026-11-21T02:00:00.000Z";

function heartbeat(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    protocolVersion: localExecutorHeartbeatProtocolVersion,
    executorId: "owner-brave-primary",
    observedAt: "2026-11-21T01:59:45.000Z",
    runtime: "brave_chromium_owner_profile",
    sessionStatus: "authenticated",
    sessionMaterialLocation: "local_only",
    nativeContractStatus: "unobserved",
    executionMode: "dry_run_only",
    supportedExecutionPurposes: ["paid_tournament", "free_discovery"],
    lastAppliedControlVersion: 7,
    walletSigningEnabled: false,
    gameSubmissionEnabled: false,
    ...overrides,
  };
}

function evaluate(
  overrides: Partial<
    Parameters<typeof evaluateLocalExecutorHeartbeatControl>[0]
  > = {},
) {
  return evaluateLocalExecutorHeartbeatControl({
    evaluatedAt,
    maximumHeartbeatAgeSeconds: 60,
    expectedExecutorId: "owner-brave-primary",
    minimumControlVersion: 7,
    requestedPurpose: "paid_tournament",
    ownerControl: {
      authorityStatus: "current",
      globallyPaused: false,
      killSwitchEngaged: false,
    },
    heartbeat: heartbeat(),
    ...overrides,
  });
}

describe("shared race-entry bot local executor heartbeat control", () => {
  it("directs contract observation while the native action remains unobserved", () => {
    expect(evaluate()).toEqual({
      healthStatus: "blocked",
      directive: "observe_native_contract",
      blockers: ["native_contract_unobserved"],
      localDryRunAllowed: false,
      requestContractIncluded: false,
      cloudCredentialStorageAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("permits protocol dry-run only for a fresh sanitized current heartbeat", () => {
    expect(
      evaluate({
        heartbeat: heartbeat({
          nativeContractStatus: "observed_current",
        }),
      }),
    ).toEqual({
      healthStatus: "healthy",
      directive: "dry_run_only",
      blockers: [],
      localDryRunAllowed: true,
      requestContractIncluded: false,
      cloudCredentialStorageAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("applies the owner kill switch and pause before all other directives", () => {
    expect(
      evaluate({
        ownerControl: {
          authorityStatus: "current",
          globallyPaused: true,
          killSwitchEngaged: true,
        },
      }),
    ).toMatchObject({
      directive: "kill",
      blockers: expect.arrayContaining([
        "globally_paused",
        "kill_switch_engaged",
      ]),
      localDryRunAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("requires a fresh identity and current control version", () => {
    expect(
      evaluate({
        heartbeat: heartbeat({
          executorId: "different-owner-executor",
          observedAt: "2026-11-21T01:58:00.000Z",
          lastAppliedControlVersion: 6,
          nativeContractStatus: "observed_current",
        }),
      }),
    ).toMatchObject({
      directive: "refresh_control",
      blockers: expect.arrayContaining([
        "executor_identity_mismatch",
        "heartbeat_stale_or_invalid",
        "executor_control_version_stale",
      ]),
      localDryRunAllowed: false,
    });
  });

  it("requires local reauthentication without carrying session material", () => {
    expect(
      evaluate({
        heartbeat: heartbeat({
          sessionStatus: "expired",
          nativeContractStatus: "observed_current",
        }),
      }),
    ).toMatchObject({
      directive: "reauthenticate",
      blockers: ["session_not_authenticated"],
      cloudCredentialStorageAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("fails closed on native contract drift", () => {
    expect(
      evaluate({
        heartbeat: heartbeat({ nativeContractStatus: "drifted" }),
      }),
    ).toMatchObject({
      directive: "contract_review_required",
      blockers: ["native_contract_drifted"],
      localDryRunAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("checks the requested shared-bot purpose", () => {
    expect(
      evaluate({
        requestedPurpose: "free_discovery",
        heartbeat: heartbeat({
          nativeContractStatus: "observed_current",
          supportedExecutionPurposes: ["paid_tournament"],
        }),
      }),
    ).toMatchObject({
      directive: "unsupported_purpose",
      blockers: ["execution_purpose_unsupported"],
      localDryRunAllowed: false,
    });
  });

  it("rejects unapproved fields before credentials can cross the boundary", () => {
    expect(() =>
      parseLocalExecutorHeartbeat(
        heartbeat({ authorization: "not-a-real-secret" }),
      ),
    ).toThrow("unapproved field");
    expect(() =>
      parseLocalExecutorHeartbeat(
        heartbeat({ sessionMaterialLocation: "cloud" }),
      ),
    ).toThrow("must remain local");
  });

  it("cannot report signing, submission or live execution as enabled", () => {
    expect(() =>
      parseLocalExecutorHeartbeat(heartbeat({ walletSigningEnabled: true })),
    ).toThrow("cannot enable signing or game submission");
    expect(() =>
      parseLocalExecutorHeartbeat(heartbeat({ gameSubmissionEnabled: true })),
    ).toThrow("cannot enable signing or game submission");
    expect(() =>
      parseLocalExecutorHeartbeat(heartbeat({ executionMode: "live" })),
    ).toThrow("execution mode is invalid");
  });
});
