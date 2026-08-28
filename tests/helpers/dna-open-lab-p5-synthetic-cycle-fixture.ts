import { vi } from "vitest";

import type { DnaOpenLabP5PrivatePreviewSyntheticCycleConfiguration } from "@/lib/dna-open-lab-p5-private-preview-synthetic-cycle";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import type { PrivateDatasetEvidenceObjectDeletionPort } from "@/lib/private-dataset-evidence-object-writer";

export function createP5SyntheticCycleFixture(input: {
  codeHeadSha: string;
  measuredAt: string;
  ownerId: string;
  databaseOwnerId: string;
  databaseUrl: string;
  runtimeRole: string;
  bucketName: string;
}) {
  let transactionRolledBack = false;
  const query = vi.fn<NeonImportPersistenceClient["query"]>();
  query.mockImplementation(async (statement) => {
    if (statement.includes("BEGIN")) return { rows: [] };
    if (statement.includes("set_config")) {
      return { rows: [{ owner_scope: input.databaseOwnerId }] };
    }
    if (statement.includes("FROM dna.app_owner")) {
      return {
        rows: [
          {
            database_owner_id: input.databaseOwnerId,
            authenticated_owner_id: input.ownerId,
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
            session_user_name: input.runtimeRole,
            current_user_name: input.runtimeRole,
            runtime_is_superuser: false,
            runtime_bypasses_rls: false,
            runtime_can_create_roles: false,
            runtime_can_create_databases: false,
            runtime_is_neon_superuser_member: false,
          },
        ],
      };
    }
    if (statement.includes("stage_dna_open_lab_token_splice_candidate")) {
      return { rows: [{ status: "staged" }] };
    }
    if (statement.includes("save_dna_open_lab_current_state_evidence_index")) {
      return { rows: [{ status: "staged" }] };
    }
    if (statement.includes("publish_dna_open_lab_indexed_sync_candidate")) {
      return { rows: [{ status: "published" }] };
    }
    if (statement.includes("read_dna_open_lab_sync_state")) {
      if (transactionRolledBack) return { rows: [] };
      const generationId = query.mock.calls.find(([sql]) =>
        sql
          .trim()
          .startsWith("SELECT dna.stage_dna_open_lab_token_splice_candidate"),
      )?.[1]?.[1];
      if (generationId === undefined) return { rows: [] };
      return {
        rows: [
          {
            accepted_generation_id: generationId,
            accepted_observed_at: new Date(input.measuredAt),
            accepted_at: new Date(Date.parse(input.measuredAt) + 2_000),
            serving_generation_id: generationId,
            sync_status: "current",
            catch_up_required: false,
            last_attempt_at: new Date(Date.parse(input.measuredAt) + 2_000),
            last_interruption_reason: null,
            last_interruption_at: null,
            retry_after_seconds: null,
            last_catch_up_completed_at: null,
          },
        ],
      };
    }
    if (statement === "ROLLBACK") {
      transactionRolledBack = true;
      return { rows: [] };
    }
    if (statement === "COMMIT") return { rows: [] };
    throw new Error(`unexpected synthetic query: ${statement}`);
  });
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn<NeonImportPersistenceSessionFactory>(
    async () => ({ client: { query }, close }),
  );

  let marker:
    | Readonly<{
        contentType: string;
        byteLength: number;
        checksumSha256: string;
        metadata: Readonly<Record<string, string>>;
      }>
    | undefined;
  const readBucketPrivacy = vi.fn(async () => ({
    publicAccessDisabled: true,
    r2DevDisabled: true,
    customDomainCount: 0,
  }));
  const putObjectIfAbsent = vi.fn<
    PrivateDatasetEvidenceObjectDeletionPort["putObjectIfAbsent"]
  >(async (request) => {
    if (marker !== undefined) return { status: "existing" };
    marker = {
      contentType: request.contentType,
      byteLength: request.byteLength,
      checksumSha256: request.checksumSha256,
      metadata: request.metadata,
    };
    return { status: "created" };
  });
  const headObject = vi.fn<
    PrivateDatasetEvidenceObjectDeletionPort["headObject"]
  >(async () =>
    marker === undefined
      ? { status: "missing" }
      : { status: "ready", ...marker },
  );
  const deleteObject = vi.fn<
    PrivateDatasetEvidenceObjectDeletionPort["deleteObject"]
  >(async () => {
    const status = marker === undefined ? "missing" : "deleted";
    marker = undefined;
    return { status };
  });
  const r2Storage: PrivateDatasetEvidenceObjectDeletionPort = {
    readBucketPrivacy,
    putObjectIfAbsent,
    headObject,
    deleteObject,
  };
  const configuration: DnaOpenLabP5PrivatePreviewSyntheticCycleConfiguration = {
    codeHeadSha: input.codeHeadSha,
    measuredAt: input.measuredAt,
    authorizedOwnerId: input.ownerId,
    databaseOwnerId: input.databaseOwnerId,
    databaseUrl: input.databaseUrl,
    runtimeRole: input.runtimeRole,
    sessionFactory,
    bucketName: input.bucketName,
    r2Storage,
  };
  return {
    configuration,
    query,
    close,
    sessionFactory,
    readBucketPrivacy,
    putObjectIfAbsent,
    headObject,
    deleteObject,
  };
}
