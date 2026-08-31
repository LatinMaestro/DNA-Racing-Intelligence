import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createDnaOpenLabP5AtomicPublicationFailureScenario } from "@/lib/dna-open-lab-p5-atomic-publication-failure-scenario";
import { createDnaOpenLabP5ComponentRecoveryCaseRunner } from "@/lib/dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "@/lib/dna-open-lab-p5-private-preview-recovery";
import {
  adaptDnaSpliceArenaPage,
  adaptDnaTokenPrices,
} from "@/lib/dna-open-lab-v1-adapters";
import {
  createNeonDnaOpenLabSyncPublicationRepository,
  type NeonDnaOpenLabSyncPublicationRepository,
} from "@/lib/neon-dna-open-lab-sync-publication";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const generationId = "22222222-2222-4222-8222-222222222222";
const lastGoodGenerationId = "33333333-3333-4333-8333-333333333333";
const ownerId = "private_owner";
const runtimeRole = "dna_app_runtime";
const failureMessage = "synthetic indexed publication interruption";

const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function isolation() {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    generation_rls: true,
    generation_force_rls: true,
    family_rls: true,
    family_force_rls: true,
    state_rls: true,
    state_force_rls: true,
    core_rls: true,
    core_force_rls: true,
    active_rls: true,
    active_force_rls: true,
    fill_rls: true,
    fill_force_rls: true,
    supplemental_rls: true,
    supplemental_force_rls: true,
    token_rls: true,
    token_force_rls: true,
    arena_mode_rls: true,
    arena_mode_force_rls: true,
    arena_page_rls: true,
    arena_page_force_rls: true,
    arena_listing_rls: true,
    arena_listing_force_rls: true,
    evidence_index_rls: true,
    evidence_index_force_rls: true,
    runtime_can_access_generation: false,
    runtime_can_access_family: false,
    runtime_can_access_state: false,
    runtime_can_access_core: false,
    runtime_can_access_active: false,
    runtime_can_access_fill: false,
    runtime_can_access_supplemental: false,
    runtime_can_access_token: false,
    runtime_can_access_arena_mode: false,
    runtime_can_access_arena_page: false,
    runtime_can_access_arena_listing: false,
    runtime_can_access_evidence_index: false,
    runtime_can_stage_legacy: false,
    runtime_can_stage_cores_only: false,
    runtime_can_stage_current_race: false,
    runtime_can_stage_supplemental: false,
    runtime_can_stage_complete: true,
    runtime_can_publish_legacy: false,
    runtime_can_save_evidence_index: true,
    runtime_can_publish: true,
    runtime_can_read_evidence_index: true,
    runtime_can_pause: true,
    runtime_can_read: true,
    runtime_can_read_cores: true,
    runtime_can_read_active: true,
    runtime_can_read_fills: true,
    runtime_can_read_supplemental: true,
    runtime_can_read_token: true,
    runtime_can_read_arena_pages: true,
    runtime_can_read_arena: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
  };
}

function publicationRequest(): Parameters<
  NeonDnaOpenLabSyncPublicationRepository["publishCandidate"]
>[0] {
  const observedAt = "2026-08-31T13:45:00.000Z";
  return {
    ownerId,
    candidate: {
      generationId,
      observedAt,
      families: {
        vault: { status: "complete", itemCount: 0 },
        cores: { status: "complete", itemCount: 0 },
        active_races: { status: "complete", itemCount: 0 },
        race_fills: { status: "complete", itemCount: 0 },
        tokens: { status: "complete", itemCount: 1 },
        splice_arena: { status: "complete", itemCount: 0 },
      },
    },
    ownedCores: [],
    activeRaces: [],
    raceFills: [],
    supplementalCore: {
      racingStats: [],
      power: [],
      listings: [],
      attachedAssets: [],
      owners: [],
      stamina: [],
      splicing: [],
    },
    tokenSplice: {
      tokenPrices: adaptDnaTokenPrices({
        observedAt,
        raw: {
          ethusd: 3200,
          btcusd: 95_000,
          dezusd: 0.1,
          hlxusd: 0.2,
          bgcusd: 1,
          tpusd: 0.3,
          methusd: 32,
          mbtcusd: 950,
        },
      }),
      arenaModes: ["bike"],
      arenaPages: [
        adaptDnaSpliceArenaPage({
          mode: "bike",
          observedAt,
          raw: {
            cores: [],
            has_more: false,
            limit: 20,
            page: 1,
          },
        }),
      ],
    },
    evidenceIndex: {
      version: 1,
      generationId,
      planSha256: "9".repeat(64),
      indexedAt: observedAt,
      receipts: [
        {
          group: "vault_identity",
          requestKey: "8".repeat(64),
          cycleId: generationId,
          observedAt,
          contentSha256: "7".repeat(64),
          evidenceObjectKey: `private/${generationId}/vault.json`,
        },
      ],
    },
    recordedAt: "2026-08-31T13:45:01.000Z",
    acceptedAt: "2026-08-31T13:45:02.000Z",
  };
}

function fixture(input: { cleanupRestoresState?: boolean } = {}) {
  let servingGeneration = lastGoodGenerationId;
  let canonicalCommitCount = 0;
  let receiptIndexCommitCount = 0;
  let failNextPublication = true;
  let stagedCanonical = false;
  let stagedReceiptIndex = false;
  let transactionPublished = false;

  const currentState = () => ({
    accepted_generation_id: generationId,
    accepted_observed_at: new Date("2026-08-31T13:45:00.000Z"),
    accepted_at: new Date("2026-08-31T13:45:02.000Z"),
    serving_generation_id: generationId,
    sync_status: "current",
    catch_up_required: false,
    last_attempt_at: new Date("2026-08-31T13:45:02.000Z"),
    last_interruption_reason: null,
    last_interruption_at: null,
    retry_after_seconds: null,
    last_catch_up_completed_at: null,
  });
  const query = async (statement: string): Promise<{ rows: unknown[] }> => {
    const normalized = statement.replace(/\s+/gu, " ").trim();
    if (normalized.startsWith("BEGIN ISOLATION LEVEL")) {
      stagedCanonical = false;
      stagedReceiptIndex = false;
      transactionPublished = false;
      return { rows: [] };
    }
    if (normalized.startsWith("SELECT set_config")) {
      return { rows: [{ owner_scope: databaseOwnerId }] };
    }
    if (normalized.includes("AS database_owner_id")) {
      return { rows: [isolation()] };
    }
    if (normalized.includes("stage_dna_open_lab_token_splice_candidate")) {
      stagedCanonical = true;
      return { rows: [{ status: "staged" }] };
    }
    if (normalized.includes("save_dna_open_lab_current_state_evidence_index")) {
      stagedReceiptIndex = true;
      return { rows: [{ status: "staged" }] };
    }
    if (normalized.includes("publish_dna_open_lab_indexed_sync_candidate")) {
      if (failNextPublication) {
        failNextPublication = false;
        throw new Error(failureMessage);
      }
      if (!stagedCanonical || !stagedReceiptIndex) throw new Error("split");
      transactionPublished = true;
      return { rows: [{ status: "published" }] };
    }
    if (normalized === "COMMIT") {
      if (transactionPublished) {
        servingGeneration = generationId;
        canonicalCommitCount += 1;
        receiptIndexCommitCount += 1;
      }
      return { rows: [] };
    }
    if (normalized === "ROLLBACK") {
      stagedCanonical = false;
      stagedReceiptIndex = false;
      transactionPublished = false;
      return { rows: [] };
    }
    if (normalized.includes("FROM dna.read_dna_open_lab_sync_state")) {
      return { rows: [currentState()] };
    }
    throw new Error(`Unexpected query: ${normalized}`);
  };
  const sessionFactory = async () => ({
    client: { query } as NeonImportPersistenceClient,
    close: async () => undefined,
  });
  const repository = createNeonDnaOpenLabSyncPublicationRepository({
    databaseUrl: "postgresql://private.example/dna",
    databaseOwnerId,
    runtimeRole,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  });
  const inspectAtomicPublication = async () => ({
    servingGeneration,
    canonicalCommitCount,
    receiptIndexCommitCount,
  });
  const inspectProviderSafety =
    async (): Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot> => ({
      ownerDataSha256: sha(`owner:${servingGeneration}`),
      checkpointStateSha256: sha("checkpoint"),
      servingStateSha256: sha(`serving:${servingGeneration}`),
      retainedEvidenceSha256: sha(
        `evidence:${canonicalCommitCount}:${receiptIndexCommitCount}`,
      ),
      persistentOwnerDataRowCount: 0,
      syntheticResidueObjectCount:
        servingGeneration === lastGoodGenerationId ? 0 : 1,
    });
  const cleanupSyntheticCase = async () => {
    if (input.cleanupRestoresState === false) return;
    servingGeneration = lastGoodGenerationId;
    canonicalCommitCount = 0;
    receiptIndexCommitCount = 0;
  };
  const scenario = createDnaOpenLabP5AtomicPublicationFailureScenario({
    attemptedAt: "2026-08-31T13:45:03.000Z",
    publicationRepository: repository,
    publicationRequest: publicationRequest(),
    expectedFailureMessage: failureMessage,
    inspectAtomicPublication,
    inspectProviderSafety,
    cleanupSyntheticCase,
  });
  return { scenario, inspectAtomicPublication };
}

describe("DNA Open Lab P5 atomic publication failure scenario", () => {
  it("rolls back both authorities and publishes one identical retry", async () => {
    const { scenario, inspectAtomicPublication } = fixture();
    const evidence = await scenario();

    expect(evidence).toMatchObject({
      caseId: "atomic_publication_failure",
      apiRequestCount: 0,
      syntheticProviderWriteCount: 2,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      servingGenerationBefore: lastGoodGenerationId,
      servingGenerationAfterFailure: lastGoodGenerationId,
      canonicalCommitCount: 0,
      receiptIndexCommitCount: 0,
      catchUpStarted: true,
      catchUpCompleted: true,
    });
    expect(evidence.firstAttemptSha256).toBe(evidence.retryAttemptSha256);
    await expect(inspectAtomicPublication()).resolves.toEqual({
      servingGeneration: lastGoodGenerationId,
      canonicalCommitCount: 0,
      receiptIndexCommitCount: 0,
    });

    const runner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: {
        atomic_publication_failure: async () => evidence,
      } as never,
    });
    await expect(runner("atomic_publication_failure")).resolves.toMatchObject({
      caseId: "atomic_publication_failure",
      outcome: "passed",
      syntheticProviderWriteCount: 2,
    });
  });

  it("fails closed if committed synthetic state is not removed", async () => {
    const { scenario } = fixture({ cleanupRestoresState: false });
    await expect(scenario()).rejects.toThrow(
      "DNA Open Lab P5 atomic-publication scenario failed.",
    );
  });
});
