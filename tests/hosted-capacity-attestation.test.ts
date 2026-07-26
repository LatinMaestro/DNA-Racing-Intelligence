import { describe, expect, it } from "vitest";

import {
  projectHostedCapacityAttestations,
  type HostedCapacityAttestationInput,
  type HostedCapacityControlAttestation,
} from "@/domain/hosted-capacity-attestation";

const HEAD = "a".repeat(40);
const CAPACITY = "b".repeat(64);
const WORKLOAD = "c".repeat(64);
const SUMMARY = "d".repeat(64);

const commands = {
  streaming_memory_bound: "capacity_verify_streaming_memory",
  preview_row_budget: "capacity_verify_preview_rows",
  queue_throughput: "capacity_verify_queue_throughput",
  queue_retry_and_dlq: "capacity_verify_queue_retry_dlq",
  database_capacity: "capacity_verify_database",
  object_storage_capacity: "capacity_verify_object_storage",
  request_latency: "capacity_verify_request_latency",
  aggregate_refresh_latency: "capacity_verify_aggregate_refresh",
  provider_quota_headroom: "capacity_verify_provider_quota",
  fail_closed_degradation: "capacity_verify_fail_closed_degradation",
} as const;

const providerControls = new Set([
  "queue_throughput",
  "queue_retry_and_dlq",
  "database_capacity",
  "object_storage_capacity",
  "request_latency",
  "aggregate_refresh_latency",
  "provider_quota_headroom",
]);

function attestations(): HostedCapacityControlAttestation[] {
  return Object.entries(commands).map(([control, commandId], index) => ({
    attestationId: `capacity-${index + 1}`,
    control: control as HostedCapacityControlAttestation["control"],
    commandId,
    headSha: HEAD,
    capacityManifestSha256: CAPACITY,
    workloadManifestSha256: WORKLOAD,
    startedAt: "2026-07-26T13:00:00.000Z",
    completedAt: "2026-07-26T13:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 10,
    assertionsTotal: 10,
    observedUnits: 80,
    approvedLimitUnits: 100,
    workloadComplete: true,
    redactedSummaryOnly: true,
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
    connectedProviderEvidence: providerControls.has(control),
    failClosedVerified: control === "fail_closed_degradation",
  }));
}

function input(
  overrides: Partial<HostedCapacityAttestationInput> = {},
): HostedCapacityAttestationInput {
  return {
    evidenceId: "hosted-capacity-attestations",
    composedHeadSha: HEAD,
    capacityManifestSha256: CAPACITY,
    workloadManifestSha256: WORKLOAD,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted capacity attestations", () => {
  it("projects complete exact-head capacity evidence without authority", () => {
    expect(projectHostedCapacityAttestations(input())).toMatchObject({
      status: "attested",
      passedControls: Object.keys(commands),
      check: { name: "performance_capacity", state: "passed", headSha: HEAD },
      issues: [],
      privateArtifactsRetained: false,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      providerMutationAllowed: false,
      productionMutationAllowed: false,
      paidServiceActivationAllowed: false,
    });
  });

  it("keeps a missing control review-required", () => {
    const result = projectHostedCapacityAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "CONTROL_MISSING",
      control: "streaming_memory_bound",
      severity: "review",
    });
  });

  it("blocks stale heads, substituted commands and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "e".repeat(40),
      commandId: "capacity_verify_preview_rows",
      capacityManifestSha256: "f".repeat(64),
      workloadManifestSha256: "0".repeat(64),
    };

    expect(
      projectHostedCapacityAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CONTROL_STALE",
        "COMMAND_MISMATCH",
        "CAPACITY_MANIFEST_MISMATCH",
        "WORKLOAD_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete and over-limit evidence", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      assertionsPassed: 9,
      workloadComplete: false,
      observedUnits: 101,
    };

    expect(
      projectHostedCapacityAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "WORKLOAD_INCOMPLETE",
        "APPROVED_LIMIT_EXCEEDED",
      ]),
    );
  });

  it("blocks unsafe or retained evidence", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      redactedSummaryOnly: false,
      syntheticFixturesOnly: false,
      privateDataObserved: true,
      retainedPrivateArtifact: true,
    };

    expect(
      projectHostedCapacityAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "UNREDACTED_SUMMARY",
        "NON_SYNTHETIC_FIXTURE",
        "PRIVATE_DATA_OBSERVED",
        "PRIVATE_ARTIFACT_RETAINED",
      ]),
    );
  });

  it("requires connected provider evidence for provider-backed controls", () => {
    const values = attestations();
    values[2] = { ...values[2]!, connectedProviderEvidence: false };

    expect(
      projectHostedCapacityAttestations(input({ attestations: values })).issues,
    ).toContainEqual({
      code: "PROVIDER_EVIDENCE_UNCONNECTED",
      control: "queue_throughput",
      severity: "block",
    });
  });

  it("requires fail-closed degradation evidence", () => {
    const values = attestations();
    values[9] = { ...values[9]!, failClosedVerified: false };

    expect(
      projectHostedCapacityAttestations(input({ attestations: values })).issues,
    ).toContainEqual({
      code: "FAIL_CLOSED_UNVERIFIED",
      control: "fail_closed_degradation",
      severity: "block",
    });
  });

  it("rejects malformed runtime values", () => {
    expect(() =>
      projectHostedCapacityAttestations({
        ...input(),
        attestations: [
          {
            ...attestations()[0]!,
            workloadComplete: "true" as unknown as boolean,
          },
        ],
      }),
    ).toThrow("explicit boolean");
  });
});
