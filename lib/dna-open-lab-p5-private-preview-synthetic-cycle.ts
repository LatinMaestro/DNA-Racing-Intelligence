import { createHash } from "node:crypto";

import type { AdaptedCoreDetailsRow } from "../domain/source-adapters";
import {
  adaptDnaCoreAttachedAssets,
  adaptDnaCoreListingPrice,
  adaptDnaCoreOwner,
  adaptDnaCorePower,
  adaptDnaCoreRacingStats,
  adaptDnaCoreSplicingInfo,
  adaptDnaCoreStamina,
  adaptDnaSpliceArenaPage,
  adaptDnaTokenPrices,
  type DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";
import type { DnaCurrentStateCandidate } from "./dna-open-lab-last-good-publication";
import type {
  DnaOpenLabP5CapacityProgressRecorder,
  DnaOpenLabP5SyntheticCleanupResult,
} from "./dna-open-lab-p5-capacity-measurement-runner";
import { createNeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";
import {
  createDefaultNeonImportPersistenceSession,
  type NeonImportPersistenceSessionFactory,
} from "./neon-import-persistence-driver";
import type { PrivateDatasetEvidenceObjectDeletionPort } from "./private-dataset-evidence-object-writer";

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_1_PATTERN = /^[a-f0-9]{40}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;

export type DnaOpenLabP5PrivatePreviewSyntheticCycleConfiguration = Readonly<{
  codeHeadSha: string;
  measuredAt: string;
  authorizedOwnerId: string;
  databaseOwnerId: string;
  databaseUrl: string;
  runtimeRole: string;
  sessionFactory?: NeonImportPersistenceSessionFactory;
  bucketName: string;
  r2Storage: PrivateDatasetEvidenceObjectDeletionPort;
  recordProgress?: DnaOpenLabP5CapacityProgressRecorder;
}>;

export type DnaOpenLabP5PrivatePreviewSyntheticCycle = Readonly<{
  runSyntheticCycle: (input: {
    captureTransientSample: () => Promise<number>;
  }) => Promise<void>;
  cleanupSyntheticEvidence: () => Promise<DnaOpenLabP5SyntheticCleanupResult>;
}>;

function cycleError(message: string): never {
  throw new Error(
    `DNA Open Lab P5 private Preview synthetic cycle: ${message}`,
  );
}

function safeText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    CONTROL_PATTERN.test(normalized)
  ) {
    cycleError(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: string): string {
  const normalized = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    cycleError("measuredAt is invalid");
  }
  return new Date(normalized).toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function generationId(codeHeadSha: string, measuredAt: string): string {
  const value = sha256(
    `dna-open-lab-p5-synthetic-generation\u0000${codeHeadSha}\u0000${measuredAt}`,
  ).slice(0, 32);
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    `4${value.slice(13, 16)}`,
    `8${value.slice(17, 20)}`,
    value.slice(20),
  ].join("-");
}

function ownerPrefix(ownerId: string): string {
  return sha256(`dna-open-lab-owner\u0000${ownerId}`);
}

function oneChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield bytes;
  })();
}

function privateBucket(input: {
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}): void {
  if (
    input.publicAccessDisabled !== true ||
    input.r2DevDisabled !== true ||
    input.customDomainCount !== 0
  ) {
    cycleError("R2 bucket is not private");
  }
}

function syntheticPublication(input: {
  generationId: string;
  observedAt: string;
  markerKey: string;
  markerChecksum: string;
}) {
  const observedTime = Date.parse(input.observedAt);
  const evidenceObservedAt = new Date(observedTime - 1_000).toISOString();
  const recordedAt = new Date(observedTime + 1_000).toISOString();
  const acceptedAt = new Date(observedTime + 2_000).toISOString();
  const sourceCoreId = "9007199254740001";
  const candidate: DnaCurrentStateCandidate = Object.freeze({
    generationId: input.generationId,
    observedAt: input.observedAt,
    families: Object.freeze({
      vault: { status: "complete" as const, itemCount: 1 },
      cores: { status: "complete" as const, itemCount: 1 },
      active_races: { status: "complete" as const, itemCount: 0 },
      race_fills: { status: "complete" as const, itemCount: 0 },
      tokens: { status: "complete" as const, itemCount: 1 },
      splice_arena: { status: "complete" as const, itemCount: 0 },
    }),
  });
  const ownedCores: readonly DnaOpenLabEvidence<AdaptedCoreDetailsRow>[] = [
    Object.freeze({
      source: "dna_open_lab" as const,
      sourceVersion: "v1" as const,
      scope: "vault" as const,
      endpoint: "vault.cores_full" as const,
      entityKey: `core:${sourceCoreId}`,
      observedAt: evidenceObservedAt,
      rawEvidenceSha256: sha256("dna-open-lab-p5-synthetic-owned-core"),
      canonical: Object.freeze({
        sourceType: "core_details" as const,
        sourceCoreId,
        displayName: "P5 Synthetic Capacity Core",
        coreClass: "Genesis" as const,
        element: "Metal" as const,
        fNumber: 999_999,
        sex: "female" as const,
        colorSourceValue: null,
        fatherSourceCoreId: null,
        fatherNameSourceValue: null,
        motherSourceCoreId: null,
        motherNameSourceValue: null,
      }),
    }),
  ];
  const numericCoreId = Number(sourceCoreId);
  const supplementalCore = {
    racingStats: [
      adaptDnaCoreRacingStats({
        observedAt: evidenceObservedAt,
        raw: {
          hid: numericCoreId,
          hstats_bike: { starts: 0 },
          hstats_car: null,
          hstats_horse: null,
          ageing: null,
          is_maiden: true,
          tourney_profits: null,
        },
      }),
    ],
    power: [
      adaptDnaCorePower({
        observedAt: evidenceObservedAt,
        raw: {
          hid: numericCoreId,
          power: {
            bike: { power: 0, adjodds: null, variance: null, races_n: 0 },
            car: { power: null, adjodds: null, variance: null, races_n: 0 },
            horse: {
              power: null,
              adjodds: null,
              variance: null,
              races_n: 0,
            },
          },
          m_stats: null,
        },
      }),
    ],
    listings: [
      adaptDnaCoreListingPrice({
        observedAt: evidenceObservedAt,
        raw: { hid: numericCoreId },
      }),
    ],
    attachedAssets: [
      adaptDnaCoreAttachedAssets({
        observedAt: evidenceObservedAt,
        raw: {
          hid: numericCoreId,
          skino: { bike: null, car: null, horse: null },
          trailsmap: null,
        },
      }),
    ],
    owners: [
      adaptDnaCoreOwner({
        observedAt: evidenceObservedAt,
        raw: { hid: numericCoreId, vault: "p5-synthetic-owner" },
      }),
    ],
    stamina: [
      adaptDnaCoreStamina({
        observedAt: evidenceObservedAt,
        raw: {
          hid: numericCoreId,
          stamina: {
            stamina: 0,
            max_stamina: 1,
            next_refill: null,
            last_event: null,
          },
          spstamina: null,
        },
      }),
    ],
    splicing: [
      adaptDnaCoreSplicingInfo({
        observedAt: evidenceObservedAt,
        raw: {
          hid: numericCoreId,
          parents: null,
          grand_parents: null,
          challenge_credit: 0,
          splice_core: null,
        },
      }),
    ],
  };
  const arenaPage = adaptDnaSpliceArenaPage({
    mode: "bike",
    observedAt: evidenceObservedAt,
    raw: { cores: [], has_more: false, limit: 20, page: 1 },
  });
  return Object.freeze({
    candidate,
    ownedCores,
    activeRaces: Object.freeze([]),
    raceFills: Object.freeze([]),
    supplementalCore,
    tokenSplice: {
      tokenPrices: adaptDnaTokenPrices({
        observedAt: evidenceObservedAt,
        raw: {
          ethusd: 0,
          btcusd: 0,
          dezusd: 0,
          hlxusd: 0,
          bgcusd: 0,
          tpusd: 0,
          methusd: 0,
          mbtcusd: 0,
        },
      }),
      arenaModes: ["bike"] as const,
      arenaPages: [arenaPage],
    },
    evidenceIndex: Object.freeze({
      version: 1 as const,
      generationId: input.generationId,
      planSha256: sha256("dna-open-lab-p5-synthetic-plan"),
      indexedAt: input.observedAt,
      receipts: Object.freeze([
        Object.freeze({
          group: "vault_identity" as const,
          requestKey: sha256("dna-open-lab-p5-synthetic-request"),
          cycleId: input.generationId,
          observedAt: input.observedAt,
          contentSha256: input.markerChecksum,
          evidenceObjectKey: input.markerKey,
        }),
      ]),
    }),
    recordedAt,
    acceptedAt,
  });
}

/**
 * Builds the only connected P5 synthetic workload. It executes the production
 * all-family publication repository but replaces its final commit with a
 * transient size sample followed by rollback. A small private R2 marker keeps
 * the object-footprint measurement real and is deleted during mandatory
 * cleanup. No API response or owner payload enters this workload.
 */
export function createDnaOpenLabP5PrivatePreviewSyntheticCycle(
  configuration: DnaOpenLabP5PrivatePreviewSyntheticCycleConfiguration,
): DnaOpenLabP5PrivatePreviewSyntheticCycle {
  const codeHeadSha = configuration.codeHeadSha.trim();
  if (!SHA_1_PATTERN.test(codeHeadSha)) cycleError("codeHeadSha is invalid");
  const measuredAt = timestamp(configuration.measuredAt);
  const authorizedOwnerId = safeText(
    configuration.authorizedOwnerId,
    "authorizedOwnerId",
    512,
  );
  const databaseOwnerId = configuration.databaseOwnerId.trim().toLowerCase();
  if (!UUID_PATTERN.test(databaseOwnerId)) {
    cycleError("databaseOwnerId is invalid");
  }
  const databaseUrl = safeText(configuration.databaseUrl, "databaseUrl", 4096);
  const runtimeRole = configuration.runtimeRole.trim();
  if (!ROLE_PATTERN.test(runtimeRole)) cycleError("runtimeRole is invalid");
  const bucketName = safeText(configuration.bucketName, "bucketName", 255);
  const sessionFactory =
    configuration.sessionFactory ?? createDefaultNeonImportPersistenceSession;
  const syntheticGenerationId = generationId(codeHeadSha, measuredAt);
  const markerKey = [
    "dna-open-lab",
    "v1",
    ownerPrefix(authorizedOwnerId),
    "p5-capacity",
    `${syntheticGenerationId}.json`,
  ].join("/");
  const markerJson = JSON.stringify({
    schemaVersion: 1,
    evidenceKind: "dna_open_lab_p5_synthetic_capacity_marker",
    generationId: syntheticGenerationId,
    measuredAt,
  });
  const markerBytes = new TextEncoder().encode(markerJson);
  const markerChecksum = sha256(markerJson);
  const publication = syntheticPublication({
    generationId: syntheticGenerationId,
    observedAt: measuredAt,
    markerKey,
    markerChecksum,
  });
  let markerCreated = false;
  let cycleStarted = false;
  let rollbackCompleted = false;

  return Object.freeze({
    async runSyntheticCycle({ captureTransientSample }) {
      if (cycleStarted) cycleError("cycle may only run once");
      cycleStarted = true;
      privateBucket(
        await configuration.r2Storage.readBucketPrivacy({ bucketName }),
      );
      configuration.recordProgress?.("r2_privacy_verified");
      if (
        (
          await configuration.r2Storage.headObject({
            bucketName,
            key: markerKey,
          })
        ).status !== "missing"
      ) {
        cycleError("synthetic marker already exists");
      }
      const write = await configuration.r2Storage.putObjectIfAbsent({
        bucketName,
        key: markerKey,
        body: oneChunk(markerBytes),
        contentType: "application/json",
        byteLength: markerBytes.byteLength,
        checksumSha256: markerChecksum,
        metadata: Object.freeze({
          evidenceKind: "dna-open-lab-p5-synthetic-capacity-marker",
          generationId: syntheticGenerationId,
        }),
      });
      if (write.status !== "created") cycleError("synthetic marker conflicted");
      markerCreated = true;
      configuration.recordProgress?.("r2_marker_created");
      const marker = await configuration.r2Storage.headObject({
        bucketName,
        key: markerKey,
      });
      if (
        marker.status !== "ready" ||
        marker.contentType !== "application/json" ||
        marker.byteLength !== markerBytes.byteLength ||
        marker.checksumSha256 !== markerChecksum
      ) {
        cycleError("synthetic marker verification failed");
      }
      configuration.recordProgress?.("r2_marker_verified");

      const rollbackSessionFactory: NeonImportPersistenceSessionFactory =
        async (url) => {
          const session = await sessionFactory(url);
          return {
            client: {
              async query(statement, values) {
                if (statement === "COMMIT") {
                  await captureTransientSample();
                  await session.client.query("ROLLBACK");
                  rollbackCompleted = true;
                  configuration.recordProgress?.("publication_rolled_back");
                  return { rows: [] };
                }
                if (statement === "ROLLBACK" && rollbackCompleted) {
                  return { rows: [] };
                }
                return session.client.query(statement, values);
              },
            },
            close: session.close,
          };
        };
      const repository = createNeonDnaOpenLabSyncPublicationRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole,
        sessionFactory: rollbackSessionFactory,
      });
      const state = await repository.publishCandidate({
        ownerId: authorizedOwnerId,
        ...publication,
      });
      if (
        !rollbackCompleted ||
        state.acceptedGenerationId !== syntheticGenerationId
      ) {
        cycleError("rollback-only publication did not complete");
      }
    },

    async cleanupSyntheticEvidence() {
      if (!cycleStarted) {
        return Object.freeze({
          persistentOwnerDataWriteCount: 0,
          residueObjectCount: 0,
          rawPayloadIncluded: false,
          secretMaterialIncluded: false,
        });
      }
      if (markerCreated) {
        await configuration.r2Storage.deleteObject({
          bucketName,
          key: markerKey,
        });
        markerCreated = false;
      }
      const marker = await configuration.r2Storage.headObject({
        bucketName,
        key: markerKey,
      });
      if (marker.status !== "missing") {
        cycleError("synthetic marker cleanup failed");
      }
      const servingState = await createNeonDnaOpenLabSyncPublicationRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole,
        sessionFactory,
      }).read({ ownerId: authorizedOwnerId });
      if (
        servingState.acceptedGenerationId === syntheticGenerationId ||
        servingState.servingGenerationId === syntheticGenerationId
      ) {
        cycleError("synthetic generation persisted");
      }
      return Object.freeze({
        persistentOwnerDataWriteCount: 0,
        residueObjectCount: 0,
        rawPayloadIncluded: false,
        secretMaterialIncluded: false,
      });
    },
  });
}
