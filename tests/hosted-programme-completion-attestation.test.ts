import { describe, expect, it } from "vitest";

import {
  projectHostedProgrammeCompletion,
  type HostedProgrammeCompletionAttestationInput,
  type ProgrammeItem,
  type ProgrammeItemAttestation,
} from "@/domain/hosted-programme-completion-attestation";

const HEAD = "a".repeat(40);
const PROGRAMME = "b".repeat(64);
const EVIDENCE = "c".repeat(64);

const commands = {
  authoritative_source_contracts: "programme_verify_source_contracts",
  private_real_file_import_assurance: "programme_verify_private_imports",
  durable_vault_identity: "programme_verify_vault_identity",
  historical_bgc_zero_economics: "programme_verify_bgc_economics",
  core_lineage_persistence: "programme_verify_lineage_persistence",
  full_integration_rehearsal: "programme_verify_integration_rehearsal",
  application_services_interfaces: "programme_verify_application_surfaces",
  private_chronological_validation: "programme_verify_chronological_validation",
  merge_queue_readiness: "programme_verify_merge_queue",
} as const;

const privateItems = new Set<ProgrammeItem>([
  "private_real_file_import_assurance",
  "durable_vault_identity",
  "historical_bgc_zero_economics",
  "private_chronological_validation",
]);
const persistenceItems = new Set<ProgrammeItem>([
  "durable_vault_identity",
  "core_lineage_persistence",
  "application_services_interfaces",
]);
const actionsItems = new Set<ProgrammeItem>([
  "full_integration_rehearsal",
  "merge_queue_readiness",
]);

function attestations(): ProgrammeItemAttestation[] {
  return Object.entries(commands).map(([itemValue, commandId], index) => {
    const item = itemValue as ProgrammeItem;
    return {
      attestationId: `programme-item-${index + 1}`,
      item,
      commandId,
      headSha: HEAD,
      programmeManifestSha256: PROGRAMME,
      evidenceManifestSha256: EVIDENCE,
      startedAt: "2026-07-26T19:00:00.000Z",
      completedAt: "2026-07-26T19:01:00.000Z",
      exitCode: 0,
      assertionsPassed: 20,
      assertionsTotal: 20,
      implementationVerified: true,
      syntheticRegressionVerified: true,
      privateExecutionState: privateItems.has(item)
        ? "verified"
        : "not_required",
      connectedPersistenceState: persistenceItems.has(item)
        ? "verified"
        : "not_required",
      exactHeadActionsState: actionsItems.has(item)
        ? "verified"
        : "not_required",
      limitationsRecorded: true,
      privateDataInGit: false,
      productionDisabled: true,
    };
  });
}

function input(
  overrides: Partial<HostedProgrammeCompletionAttestationInput> = {},
): HostedProgrammeCompletionAttestationInput {
  return {
    evidenceId: "nine-item-programme-completion",
    composedHeadSha: HEAD,
    programmeManifestSha256: PROGRAMME,
    evidenceManifestSha256: EVIDENCE,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted programme completion attestations", () => {
  it("requires all nine verified items without granting execution authority", () => {
    expect(projectHostedProgrammeCompletion(input())).toMatchObject({
      status: "ready_for_formal_acceptance",
      allNineItemsComplete: true,
      check: {
        name: "nine_item_programme_completion",
        state: "passed",
        headSha: HEAD,
      },
      technicallyVerifiedItems: Object.keys(commands),
      pendingItems: [],
      formalAcceptanceStillRequired: true,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      providerMutationAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("keeps missing items pending", () => {
    const result = projectHostedProgrammeCompletion(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result.status).toBe("completion_evidence_pending");
    expect(result.allNineItemsComplete).toBe(false);
    expect(result.issues).toContainEqual({
      code: "ITEM_MISSING",
      item: "authoritative_source_contracts",
      severity: "review",
    });
  });

  it("keeps unavailable private execution and persistence pending", () => {
    const values = attestations();
    const index = values.findIndex(
      ({ item }) => item === "durable_vault_identity",
    );
    values[index] = {
      ...values[index]!,
      privateExecutionState: "unavailable",
      connectedPersistenceState: "unavailable",
    };
    const result = projectHostedProgrammeCompletion(
      input({ attestations: values }),
    );

    expect(result.status).toBe("completion_evidence_pending");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        {
          code: "PRIVATE_EXECUTION_PENDING",
          item: "durable_vault_identity",
          severity: "review",
        },
        {
          code: "PERSISTENCE_PENDING",
          item: "durable_vault_identity",
          severity: "review",
        },
      ]),
    );
  });

  it("keeps unavailable exact-head Actions pending", () => {
    const values = attestations();
    const index = values.findIndex(
      ({ item }) => item === "full_integration_rehearsal",
    );
    values[index] = {
      ...values[index]!,
      exactHeadActionsState: "unavailable",
    };
    const result = projectHostedProgrammeCompletion(
      input({ attestations: values }),
    );

    expect(result.status).toBe("completion_evidence_pending");
    expect(result.issues).toContainEqual({
      code: "EXACT_HEAD_ACTIONS_PENDING",
      item: "full_integration_rehearsal",
      severity: "review",
    });
  });

  it("blocks stale, substituted or drifting manifests", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "d".repeat(40),
      commandId: "programme_verify_merge_queue",
      programmeManifestSha256: "e".repeat(64),
      evidenceManifestSha256: "f".repeat(64),
    };
    const result = projectHostedProgrammeCompletion(
      input({ attestations: values }),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "ITEM_STALE",
        "COMMAND_MISMATCH",
        "PROGRAMME_MANIFEST_MISMATCH",
        "EVIDENCE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete or unverified evidence", () => {
    const values = attestations();
    values[6] = {
      ...values[6]!,
      exitCode: 1,
      assertionsPassed: 19,
      implementationVerified: false,
      syntheticRegressionVerified: false,
    };
    const result = projectHostedProgrammeCompletion(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "IMPLEMENTATION_UNVERIFIED",
        "SYNTHETIC_REGRESSION_UNVERIFIED",
      ]),
    );
  });

  it("blocks private Git evidence, Production or missing limitations", () => {
    const values = attestations();
    values[8] = {
      ...values[8]!,
      limitationsRecorded: false,
      privateDataInGit: true,
      productionDisabled: false,
      completedAt: "2026-07-26T18:59:00.000Z",
    };
    const result = projectHostedProgrammeCompletion(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "LIMITATIONS_UNRECORDED",
        "PRIVATE_DATA_IN_GIT",
        "PRODUCTION_ENABLED",
        "INVALID_TIME_ORDER",
      ]),
    );
  });

  it("rejects malformed states and duplicate items", () => {
    const values = attestations();
    expect(() =>
      projectHostedProgrammeCompletion(
        input({ attestations: [...values, values[0]!] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      projectHostedProgrammeCompletion(
        input({
          attestations: [
            {
              ...values[0]!,
              privateExecutionState:
                "pending" as unknown as ProgrammeItemAttestation["privateExecutionState"],
            },
          ],
        }),
      ),
    ).toThrow("state is invalid");
  });
});
