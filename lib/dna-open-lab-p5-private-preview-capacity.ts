import {
  createCloudflareDnaOpenLabP5R2FootprintPort,
  type CloudflareDnaOpenLabP5R2FootprintPortConfiguration,
} from "./cloudflare-dna-open-lab-p5-r2-footprint-port";
import { runDnaOpenLabP5CapacityMeasurement } from "./dna-open-lab-p5-capacity-measurement-runner";
import type { DnaOpenLabP5CapacityMeasurementReport } from "./dna-open-lab-p5-capacity-measurement";
import {
  createNeonDnaOpenLabP5PostgresCapacityPort,
  type NeonDnaOpenLabP5CapacityPortConfiguration,
} from "./neon-dna-open-lab-p5-capacity-port";
import { createDnaOpenLabP5PrivatePreviewSyntheticCycle } from "./dna-open-lab-p5-private-preview-synthetic-cycle";
import type { PrivateDatasetEvidenceObjectDeletionPort } from "./private-dataset-evidence-object-writer";

export type DnaOpenLabP5PrivatePreviewCapacityConfiguration = Readonly<{
  codeHeadSha: string;
  planChecksum: string;
  measurementAuthorityRef: string;
  measuredAt: string;
  neon: NeonDnaOpenLabP5CapacityPortConfiguration;
  r2: CloudflareDnaOpenLabP5R2FootprintPortConfiguration;
  syntheticR2Storage: PrivateDatasetEvidenceObjectDeletionPort;
  projectedMonthlyClassAOperations: number;
  projectedMonthlyClassBOperations: number;
  priceAuthorityRef: string;
  priceEffectiveAt: string;
  bytesPerBillableGb: number;
  storageMicroUsdPerGbMonth: number;
  classAMicroUsdPerMillion: number;
  classBMicroUsdPerMillion: number;
  r2PageLimit?: number;
  r2MaximumPages?: number;
  r2MaximumObjects?: number;
}>;

/**
 * The sole connected capacity composition boundary. Provider scope is fixed to
 * private Preview and both provider ports are constructed from the guarded
 * implementations, so callers cannot substitute local evidence or a partial
 * PostgreSQL relation inventory.
 */
export function runDnaOpenLabP5PrivatePreviewCapacityMeasurement(
  configuration: DnaOpenLabP5PrivatePreviewCapacityConfiguration,
): Promise<DnaOpenLabP5CapacityMeasurementReport> {
  const syntheticCycle = createDnaOpenLabP5PrivatePreviewSyntheticCycle({
    codeHeadSha: configuration.codeHeadSha,
    measuredAt: configuration.measuredAt,
    authorizedOwnerId: configuration.neon.authorizedOwnerId,
    databaseOwnerId: configuration.neon.databaseOwnerId,
    databaseUrl: configuration.neon.databaseUrl,
    runtimeRole: configuration.neon.runtimeRole,
    ...(configuration.neon.sessionFactory === undefined
      ? {}
      : { sessionFactory: configuration.neon.sessionFactory }),
    bucketName: configuration.r2.bucketName,
    r2Storage: configuration.syntheticR2Storage,
  });
  return runDnaOpenLabP5CapacityMeasurement({
    codeHeadSha: configuration.codeHeadSha,
    planChecksum: configuration.planChecksum,
    providerScope: "private_preview",
    measurementAuthorityRef: configuration.measurementAuthorityRef,
    measuredAt: configuration.measuredAt,
    postgres: createNeonDnaOpenLabP5PostgresCapacityPort(configuration.neon),
    r2: createCloudflareDnaOpenLabP5R2FootprintPort(configuration.r2),
    runSyntheticCycle: syntheticCycle.runSyntheticCycle,
    cleanupSyntheticEvidence: syntheticCycle.cleanupSyntheticEvidence,
    projectedMonthlyClassAOperations:
      configuration.projectedMonthlyClassAOperations,
    projectedMonthlyClassBOperations:
      configuration.projectedMonthlyClassBOperations,
    priceAuthorityRef: configuration.priceAuthorityRef,
    priceEffectiveAt: configuration.priceEffectiveAt,
    bytesPerBillableGb: configuration.bytesPerBillableGb,
    storageMicroUsdPerGbMonth: configuration.storageMicroUsdPerGbMonth,
    classAMicroUsdPerMillion: configuration.classAMicroUsdPerMillion,
    classBMicroUsdPerMillion: configuration.classBMicroUsdPerMillion,
    ...(configuration.r2PageLimit === undefined
      ? {}
      : { r2PageLimit: configuration.r2PageLimit }),
    ...(configuration.r2MaximumPages === undefined
      ? {}
      : { r2MaximumPages: configuration.r2MaximumPages }),
    ...(configuration.r2MaximumObjects === undefined
      ? {}
      : { r2MaximumObjects: configuration.r2MaximumObjects }),
  });
}
