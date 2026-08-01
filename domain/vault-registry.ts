import { deriveFreshness, type FreshnessState } from "@/domain/freshness";

export const maidenStates = [
  "eligible",
  "not_eligible",
  "unknown",
  "invalid",
] as const;
export type MaidenState = (typeof maidenStates)[number];

export type VaultSnapshotEntry = Readonly<{
  entryId: string;
  proposedCoreId: string | null;
  confirmedCoreId: string | null;
  maidenState: MaidenState;
}>;

export type CurrentVaultSnapshot = Readonly<{
  snapshotId: string;
  dataCurrentThrough: string;
  lastImportedAt: string;
  entries: readonly VaultSnapshotEntry[];
}>;

export type ManualOwnershipEdit = Readonly<{
  editId: string;
  coreId: string;
  action: (typeof ownershipActions)[number];
  effectiveAt: string;
  reason: string;
}>;

export const ownershipActions = ["add", "remove"] as const;
export const manualMaidenStates = [
  "eligible",
  "not_eligible",
  "unknown",
] as const;

export type ManualMaidenOverride = Readonly<{
  overrideId: string;
  coreId: string;
  maidenState: (typeof manualMaidenStates)[number];
  effectiveAt: string;
  reason: string;
}>;

export type VaultRegistryWarning = Readonly<{
  code:
    | "unresolved_identity"
    | "missing_core_details"
    | "redundant_manual_add"
    | "redundant_manual_remove"
    | "inactive_maiden_override";
  referenceId: string;
  coreId: string | null;
}>;

export type CurrentVaultCore = Readonly<{
  coreId: string;
  ownershipSource: "snapshot" | "manual";
  maidenState: MaidenState;
  maidenSource: "snapshot" | "manual_override" | "unknown";
  profileStatus: "ready" | "missing_core_details";
}>;

export type CurrentVaultRegistry = Readonly<{
  dataCurrentThrough: string | null;
  lastImportedAt: string | null;
  freshness: FreshnessState;
  cores: readonly CurrentVaultCore[];
  unresolvedIdentityCount: number;
  supersededOwnershipEditCount: number;
  supersededMaidenOverrideCount: number;
  warnings: readonly VaultRegistryWarning[];
}>;

function requireId(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} is required`);
}

function canonicalTimestamp(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO-8601 timestamp`);
  }
  return parsed;
}

function assertUniqueIds(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${field} must be unique`);
  }
}

function assertSnapshot(snapshot: CurrentVaultSnapshot): void {
  requireId(snapshot.snapshotId, "snapshotId");
  const currentThrough = canonicalTimestamp(
    snapshot.dataCurrentThrough,
    "dataCurrentThrough",
  );
  const importedAt = canonicalTimestamp(
    snapshot.lastImportedAt,
    "lastImportedAt",
  );
  if (currentThrough > importedAt) {
    throw new Error("dataCurrentThrough cannot follow lastImportedAt");
  }

  assertUniqueIds(
    snapshot.entries.map(({ entryId }) => entryId),
    "vault snapshot entryId",
  );
  const confirmedCoreIds: string[] = [];
  for (const entry of snapshot.entries) {
    requireId(entry.entryId, "entryId");
    if (!maidenStates.includes(entry.maidenState)) {
      throw new Error(`Invalid Maiden state for ${entry.entryId}`);
    }
    if (entry.proposedCoreId !== null) {
      requireId(entry.proposedCoreId, "proposedCoreId");
    }
    if (entry.confirmedCoreId !== null) {
      requireId(entry.confirmedCoreId, "confirmedCoreId");
      confirmedCoreIds.push(entry.confirmedCoreId);
    }
  }
  assertUniqueIds(confirmedCoreIds, "confirmed vault coreId");
}

function assertOwnershipEdits(edits: readonly ManualOwnershipEdit[]): void {
  assertUniqueIds(
    edits.map(({ editId }) => editId),
    "ownership editId",
  );
  for (const edit of edits) {
    requireId(edit.editId, "editId");
    requireId(edit.coreId, "coreId");
    requireId(edit.reason, "ownership edit reason");
    canonicalTimestamp(edit.effectiveAt, "ownership effectiveAt");
    if (!ownershipActions.includes(edit.action)) {
      throw new Error(`Invalid ownership action for ${edit.editId}`);
    }
  }
}

function assertMaidenOverrides(
  overrides: readonly ManualMaidenOverride[],
): void {
  assertUniqueIds(
    overrides.map(({ overrideId }) => overrideId),
    "Maiden overrideId",
  );
  for (const override of overrides) {
    requireId(override.overrideId, "overrideId");
    requireId(override.coreId, "coreId");
    requireId(override.reason, "Maiden override reason");
    canonicalTimestamp(override.effectiveAt, "Maiden effectiveAt");
    if (!manualMaidenStates.includes(override.maidenState)) {
      throw new Error(`Invalid Maiden override for ${override.overrideId}`);
    }
  }
}

export function buildCurrentVaultRegistry(input: {
  snapshot: CurrentVaultSnapshot | null;
  ownershipEdits: readonly ManualOwnershipEdit[];
  maidenOverrides: readonly ManualMaidenOverride[];
  knownCoreIds: readonly string[];
  now: Date;
}): CurrentVaultRegistry {
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("now must be valid");
  }
  if (input.snapshot) assertSnapshot(input.snapshot);
  assertOwnershipEdits(input.ownershipEdits);
  assertMaidenOverrides(input.maidenOverrides);
  input.knownCoreIds.forEach((coreId) => requireId(coreId, "known coreId"));
  assertUniqueIds(input.knownCoreIds, "known coreId");

  const warnings: VaultRegistryWarning[] = [];
  const active = new Map<string, Omit<CurrentVaultCore, "profileStatus">>();
  const snapshotMaidenState = new Map<string, MaidenState>();

  for (const entry of input.snapshot?.entries ?? []) {
    if (entry.confirmedCoreId === null) {
      warnings.push({
        code: "unresolved_identity",
        referenceId: entry.entryId,
        coreId: entry.proposedCoreId,
      });
      continue;
    }
    snapshotMaidenState.set(entry.confirmedCoreId, entry.maidenState);
    active.set(entry.confirmedCoreId, {
      coreId: entry.confirmedCoreId,
      ownershipSource: "snapshot",
      maidenState: entry.maidenState,
      maidenSource:
        entry.maidenState === "unknown" || entry.maidenState === "invalid"
          ? "unknown"
          : "snapshot",
    });
  }

  const snapshotImportedAt = input.snapshot
    ? Date.parse(input.snapshot.lastImportedAt)
    : null;
  let supersededOwnershipEditCount = 0;
  let supersededMaidenOverrideCount = 0;

  type VaultTimelineEvent =
    | Readonly<{
        kind: "ownership";
        effectiveAt: string;
        referenceId: string;
        value: ManualOwnershipEdit;
      }>
    | Readonly<{
        kind: "maiden";
        effectiveAt: string;
        referenceId: string;
        value: ManualMaidenOverride;
      }>;

  const timeline: VaultTimelineEvent[] = [];

  for (const edit of input.ownershipEdits) {
    if (
      snapshotImportedAt !== null &&
      Date.parse(edit.effectiveAt) < snapshotImportedAt
    ) {
      supersededOwnershipEditCount += 1;
      continue;
    }
    timeline.push({
      kind: "ownership",
      effectiveAt: edit.effectiveAt,
      referenceId: edit.editId,
      value: edit,
    });
  }

  for (const override of input.maidenOverrides) {
    if (
      snapshotImportedAt !== null &&
      Date.parse(override.effectiveAt) < snapshotImportedAt
    ) {
      supersededMaidenOverrideCount += 1;
      continue;
    }
    timeline.push({
      kind: "maiden",
      effectiveAt: override.effectiveAt,
      referenceId: override.overrideId,
      value: override,
    });
  }

  timeline.sort(
    (left, right) =>
      Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt) ||
      (left.kind === right.kind ? 0 : left.kind === "ownership" ? -1 : 1) ||
      left.referenceId.localeCompare(right.referenceId),
  );

  for (const event of timeline) {
    if (event.kind === "ownership") {
      const edit = event.value;
      if (edit.action === "add") {
        if (active.has(edit.coreId)) {
          warnings.push({
            code: "redundant_manual_add",
            referenceId: edit.editId,
            coreId: edit.coreId,
          });
          continue;
        }
        const priorMaidenState =
          snapshotMaidenState.get(edit.coreId) ?? "unknown";
        active.set(edit.coreId, {
          coreId: edit.coreId,
          ownershipSource: "manual",
          maidenState: priorMaidenState,
          maidenSource:
            priorMaidenState === "eligible" ||
            priorMaidenState === "not_eligible"
              ? "snapshot"
              : "unknown",
        });
        continue;
      }

      if (!active.delete(edit.coreId)) {
        warnings.push({
          code: "redundant_manual_remove",
          referenceId: edit.editId,
          coreId: edit.coreId,
        });
      }
      continue;
    }

    const override = event.value;
    const core = active.get(override.coreId);
    if (!core) {
      warnings.push({
        code: "inactive_maiden_override",
        referenceId: override.overrideId,
        coreId: override.coreId,
      });
      continue;
    }
    active.set(override.coreId, {
      ...core,
      maidenState: override.maidenState,
      maidenSource: "manual_override",
    });
  }

  const knownCoreIds = new Set(input.knownCoreIds);
  const cores = [...active.values()]
    .map<CurrentVaultCore>((core) => {
      const profileStatus = knownCoreIds.has(core.coreId)
        ? "ready"
        : "missing_core_details";
      if (profileStatus === "missing_core_details") {
        warnings.push({
          code: "missing_core_details",
          referenceId: core.coreId,
          coreId: core.coreId,
        });
      }
      return { ...core, profileStatus };
    })
    .sort((left, right) => left.coreId.localeCompare(right.coreId));

  return {
    dataCurrentThrough: input.snapshot?.dataCurrentThrough ?? null,
    lastImportedAt: input.snapshot?.lastImportedAt ?? null,
    freshness: deriveFreshness(
      input.snapshot ? new Date(input.snapshot.dataCurrentThrough) : null,
      input.now,
    ),
    cores,
    unresolvedIdentityCount: warnings.filter(
      ({ code }) => code === "unresolved_identity",
    ).length,
    supersededOwnershipEditCount,
    supersededMaidenOverrideCount,
    warnings: warnings.sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        left.referenceId.localeCompare(right.referenceId),
    ),
  };
}
