import {
  allocateMaidenVaultOpportunities,
  type MaidenAllocationBracketInput,
  type MaidenAllocationCandidateInput,
  type MaidenVaultAllocation,
} from "@/domain/maiden-vault-allocation";
import { deriveFreshness } from "@/domain/freshness";

export type MaidenAllocationRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadAllocationEvidenceByOwner: (ownerId: string) => Promise<
        Readonly<{
          brackets: readonly MaidenAllocationBracketInput[];
          candidates: readonly MaidenAllocationCandidateInput[];
          lastImportedAt: string | null;
        }>
      >;
    }>;

export type MaidenWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type MaidenWorkspacePageState = Readonly<{
  allocation: MaidenVaultAllocation | null;
  lastImportedAt: string | null;
  connectionStatus: MaidenWorkspaceConnectionStatus;
}>;

export const unavailableMaidenAllocationRepository: MaidenAllocationRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function canonicalTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function validNow(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Maiden now must be valid.");
  }
  return value;
}

function normalizeCandidates(
  candidates: readonly MaidenAllocationCandidateInput[],
  lastImportedAt: string | null,
  now: Date,
): readonly MaidenAllocationCandidateInput[] {
  const importedAtMillis =
    lastImportedAt === null ? null : Date.parse(lastImportedAt);
  return candidates.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error("Maiden candidate evidence is invalid.");
    }
    const dataCurrentThrough = canonicalTimestamp(
      candidate.dataCurrentThrough,
      "Maiden data current through",
    );
    if (dataCurrentThrough !== null) {
      const cutoffMillis = Date.parse(dataCurrentThrough);
      if (
        cutoffMillis > now.getTime() ||
        (importedAtMillis !== null && cutoffMillis > importedAtMillis)
      ) {
        throw new Error(
          "Maiden data cutoff cannot be in the future or follow its import.",
        );
      }
    }
    return {
      ...candidate,
      dataCurrentThrough,
      lastImported: lastImportedAt,
      freshness:
        lastImportedAt === null
          ? "unknown"
          : deriveFreshness(
              dataCurrentThrough === null ? null : new Date(dataCurrentThrough),
              now,
            ),
    };
  });
}

export async function loadMaidenWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: MaidenAllocationRepository;
    now: Date;
  }>,
): Promise<MaidenWorkspacePageState> {
  const now = validNow(input.now);
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      allocation: null,
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Maiden workspace access denied.");
  }
  if (
    typeof input.repository !== "object" ||
    input.repository === null ||
    !["not_configured", "ready"].includes(input.repository.status)
  ) {
    throw new Error("Maiden repository status is invalid.");
  }
  if (input.repository.status === "not_configured") {
    return {
      allocation: null,
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    };
  }
  if (typeof input.repository.loadAllocationEvidenceByOwner !== "function") {
    throw new Error("Maiden repository is invalid.");
  }

  const evidence =
    await input.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId);
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    !Array.isArray(evidence.brackets) ||
    !Array.isArray(evidence.candidates)
  ) {
    throw new Error("Maiden evidence is invalid.");
  }
  const lastImportedAt = canonicalTimestamp(
    evidence.lastImportedAt,
    "Maiden import timestamp",
  );
  if (lastImportedAt !== null && Date.parse(lastImportedAt) > now.getTime()) {
    throw new Error("Maiden import timestamp cannot be in the future.");
  }
  if (evidence.brackets.length === 0 && evidence.candidates.length > 0) {
    throw new Error("Maiden candidates require configured brackets.");
  }

  return {
    allocation:
      evidence.brackets.length === 0
        ? null
        : allocateMaidenVaultOpportunities(
            evidence.brackets,
            normalizeCandidates(evidence.candidates, lastImportedAt, now),
          ),
    lastImportedAt,
    connectionStatus: "read_model_connected",
  };
}
