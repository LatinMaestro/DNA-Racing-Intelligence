import type { DnaPopulationEntrantAuthorityCapacityGate } from "./dna-population-entrant-authority-commit-protocol";
import type { DnaPopulationEntrantAuthorityLiveAuditSource } from "./dna-population-entrant-authority-cohort-command";

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaPopulationEntrantAuthorityReadinessReceipt = Readonly<{
  status: "ready";
  exactCodeHeadSha: string;
  unresolvedRaceCount: number;
  unresolvedRaceSetSha256: string;
  capacityObservedAt: string;
  previewOnly: true;
  dnaEntrantHydrationPerformed: false;
  checkpointInitializationPerformed: false;
  entrantChunkPersistentWritePerformed: false;
  providerWritePerformed: false;
  paidUsageAllowed: false;
}>;

export class DnaPopulationEntrantAuthorityReadinessError extends Error {
  constructor() {
    super("Population entrant commissioning readiness is unavailable");
    this.name = "DnaPopulationEntrantAuthorityReadinessError";
  }
}

function unavailable(): never {
  throw new DnaPopulationEntrantAuthorityReadinessError();
}

function identity(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  )
    unavailable();
  return value;
}

function exactHead(value: string): string {
  const normalized = identity(value).toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) unavailable();
  return normalized;
}

function exactTimestamp(value: string): string {
  if (typeof value !== "string") unavailable();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    unavailable();
  }
  return parsed.toISOString();
}

export function createDnaPopulationEntrantAuthorityReadinessInspector(input: {
  ownerId: string;
  exactCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  capacityGate: DnaPopulationEntrantAuthorityCapacityGate;
}): Readonly<{
  inspect: () => Promise<DnaPopulationEntrantAuthorityReadinessReceipt>;
}> {
  const ownerId = identity(input.ownerId);
  const exactCodeHeadSha = exactHead(input.exactCodeHeadSha);

  return Object.freeze({
    async inspect() {
      try {
        const audit = await input.authoritySource.load({
          ownerId,
          exactCodeHeadSha,
        });
        const authority = audit.authority;
        if (
          audit.exactCodeHeadSha !== exactCodeHeadSha ||
          authority.version !== 1 ||
          !Number.isSafeInteger(authority.unresolvedRaceCount) ||
          authority.unresolvedRaceCount < 1 ||
          authority.generationId !== authority.unresolvedRaceSetSha256
        )
          unavailable();

        const approval =
          await input.capacityGate.assertFreshCurrentCapacity(authority);
        if (
          approval.version !== 1 ||
          approval.capacityAllowed !== true ||
          approval.paidUsageAllowed !== false ||
          approval.generationId !== authority.generationId ||
          approval.unresolvedRaceCount !== authority.unresolvedRaceCount ||
          approval.unresolvedRaceSetSha256 !== authority.unresolvedRaceSetSha256
        )
          unavailable();

        return Object.freeze({
          status: "ready" as const,
          exactCodeHeadSha,
          unresolvedRaceCount: authority.unresolvedRaceCount,
          unresolvedRaceSetSha256: authority.unresolvedRaceSetSha256,
          capacityObservedAt: exactTimestamp(approval.observedAt),
          previewOnly: true as const,
          dnaEntrantHydrationPerformed: false as const,
          checkpointInitializationPerformed: false as const,
          entrantChunkPersistentWritePerformed: false as const,
          providerWritePerformed: false as const,
          paidUsageAllowed: false as const,
        });
      } catch (error) {
        if (error instanceof DnaPopulationEntrantAuthorityReadinessError) {
          throw error;
        }
        unavailable();
      }
    },
  });
}
