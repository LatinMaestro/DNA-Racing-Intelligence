import {
  createDnaOpenLabSyncRatePolicy,
  evaluateDnaOpenLabSyncRatePolicy,
  type DnaOpenLabSyncRatePolicy,
} from "@/domain/dna-open-lab-sync-rate-policy";

export type DnaOpenLabSyncRatePolicyRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      read: (ownerId: string) => Promise<DnaOpenLabSyncRatePolicy | null>;
      set: (
        input: Readonly<{
          ownerId: string;
          requestedRequestsPerMinute: number;
          elevatedUntil: string | null;
          expectedVersion: number;
          requestedAt: string;
        }>,
      ) => Promise<DnaOpenLabSyncRatePolicy>;
      recordObservation: (
        input: Readonly<{
          ownerId: string;
          rateLimited: boolean;
          providerLimit: number | null;
          observedAt: string;
        }>,
      ) => Promise<DnaOpenLabSyncRatePolicy>;
    }>;

export type DnaOpenLabSyncRatePageState = Readonly<{
  connectionStatus:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "connected"
    | "persistence_unavailable";
  policy: DnaOpenLabSyncRatePolicy;
  expectedVersion: number;
}>;

export type DnaOpenLabSyncRateRuntimePolicy = Readonly<{
  effectiveRequestsPerMinute: number;
  policy: DnaOpenLabSyncRatePolicy;
  recordObservation: (
    input: Readonly<{
      rateLimited: boolean;
      providerLimit: number | null;
    }>,
  ) => Promise<DnaOpenLabSyncRatePolicy>;
}>;

function identity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function safeDefault(now: string): DnaOpenLabSyncRatePolicy {
  return createDnaOpenLabSyncRatePolicy({
    requestedRequestsPerMinute: 30,
    now,
    version: 1,
  });
}

export async function loadDnaOpenLabSyncRatePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: DnaOpenLabSyncRatePolicyRepository;
    now: Date;
  }>,
): Promise<DnaOpenLabSyncRatePageState> {
  const now = input.now.toISOString();
  const authenticatedOwnerId = identity(input.authenticatedOwnerId);
  const configuredOwnerId = identity(input.configuredOwnerId);
  if (
    authenticatedOwnerId === null ||
    configuredOwnerId === null ||
    authenticatedOwnerId !== configuredOwnerId
  ) {
    return {
      connectionStatus: "identity_not_connected",
      policy: safeDefault(now),
      expectedVersion: 0,
    };
  }
  if (input.repository.status === "not_configured") {
    return {
      connectionStatus: "persistence_not_configured",
      policy: safeDefault(now),
      expectedVersion: 0,
    };
  }
  try {
    const stored = await input.repository.read(authenticatedOwnerId);
    return {
      connectionStatus: "connected",
      policy: evaluateDnaOpenLabSyncRatePolicy(stored ?? safeDefault(now), now),
      expectedVersion: stored?.version ?? 0,
    };
  } catch {
    return {
      connectionStatus: "persistence_unavailable",
      policy: safeDefault(now),
      expectedVersion: 0,
    };
  }
}

export async function updateDnaOpenLabSyncRatePolicy(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: DnaOpenLabSyncRatePolicyRepository;
    requestedRequestsPerMinute: number;
    elevationHours: number | null;
    expectedVersion: number;
    now: Date;
  }>,
): Promise<"updated" | "denied" | "unavailable" | "invalid"> {
  const authenticatedOwnerId = identity(input.authenticatedOwnerId);
  const configuredOwnerId = identity(input.configuredOwnerId);
  if (
    authenticatedOwnerId === null ||
    configuredOwnerId === null ||
    authenticatedOwnerId !== configuredOwnerId
  )
    return "denied";
  if (input.repository.status === "not_configured") return "unavailable";
  const now = input.now.toISOString();
  let policy: DnaOpenLabSyncRatePolicy;
  try {
    const elevatedUntil =
      input.requestedRequestsPerMinute > 30 && input.elevationHours !== null
        ? new Date(
            input.now.getTime() + input.elevationHours * 60 * 60_000,
          ).toISOString()
        : null;
    policy = createDnaOpenLabSyncRatePolicy({
      requestedRequestsPerMinute: input.requestedRequestsPerMinute,
      elevatedUntil,
      now,
      version: Math.max(1, input.expectedVersion || 1),
    });
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    ) {
      return "invalid";
    }
  } catch {
    return "invalid";
  }
  try {
    await input.repository.set({
      ownerId: authenticatedOwnerId,
      requestedRequestsPerMinute: policy.requestedRequestsPerMinute,
      elevatedUntil: policy.elevatedUntil,
      expectedVersion: input.expectedVersion,
      requestedAt: now,
    });
    return "updated";
  } catch {
    return "unavailable";
  }
}

export async function loadDnaOpenLabSyncRateRuntimePolicy(
  input: Readonly<{
    ownerId: string;
    repository: DnaOpenLabSyncRatePolicyRepository;
    now: () => Date;
  }>,
): Promise<DnaOpenLabSyncRateRuntimePolicy> {
  const ownerId = identity(input.ownerId);
  const safe = safeDefault(input.now().toISOString());
  if (ownerId === null || input.repository.status === "not_configured") {
    return Object.freeze({
      effectiveRequestsPerMinute: 30,
      policy: safe,
      recordObservation: async () => safe,
    });
  }
  const repository = input.repository;
  let policy: DnaOpenLabSyncRatePolicy;
  try {
    policy = evaluateDnaOpenLabSyncRatePolicy(
      (await repository.read(ownerId)) ?? safe,
      input.now().toISOString(),
    );
  } catch {
    policy = safe;
  }
  return Object.freeze({
    effectiveRequestsPerMinute: policy.effectiveRequestsPerMinute,
    policy,
    recordObservation: async (observation) =>
      repository.recordObservation({
        ownerId,
        rateLimited: observation.rateLimited,
        providerLimit: observation.providerLimit,
        observedAt: input.now().toISOString(),
      }),
  });
}
