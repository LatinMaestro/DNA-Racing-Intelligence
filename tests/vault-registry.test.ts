import { describe, expect, it } from "vitest";
import {
  buildCurrentVaultRegistry,
  type CurrentVaultSnapshot,
  type ManualMaidenOverride,
  type ManualOwnershipEdit,
} from "@/domain/vault-registry";

const now = new Date("2026-07-23T00:00:00.000Z");

function snapshot(
  entries: CurrentVaultSnapshot["entries"],
): CurrentVaultSnapshot {
  return {
    snapshotId: "snapshot-1",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    lastImportedAt: "2026-07-20T01:00:00.000Z",
    entries,
  };
}

function ownershipEdit(
  editId: string,
  coreId: string,
  action: ManualOwnershipEdit["action"],
  effectiveAt = "2026-07-21T00:00:00.000Z",
): ManualOwnershipEdit {
  return {
    editId,
    coreId,
    action,
    effectiveAt,
    reason: "Synthetic owner correction",
  };
}

function maidenOverride(
  overrideId: string,
  coreId: string,
  maidenState: ManualMaidenOverride["maidenState"],
  effectiveAt = "2026-07-21T00:00:00.000Z",
): ManualMaidenOverride {
  return {
    overrideId,
    coreId,
    maidenState,
    effectiveAt,
    reason: "Synthetic owner confirmation",
  };
}

describe("Phase 2 current Vault registry", () => {
  it("locks ownership only to confirmed durable IDs", () => {
    const registry = buildCurrentVaultRegistry({
      snapshot: snapshot([
        {
          entryId: "entry-confirmed",
          proposedCoreId: "core-a",
          confirmedCoreId: "core-a",
          maidenState: "eligible",
        },
        {
          entryId: "entry-proposed",
          proposedCoreId: "core-b",
          confirmedCoreId: null,
          maidenState: "not_eligible",
        },
        {
          entryId: "entry-unmatched",
          proposedCoreId: null,
          confirmedCoreId: null,
          maidenState: "unknown",
        },
      ]),
      ownershipEdits: [],
      maidenOverrides: [],
      knownCoreIds: ["core-a", "core-b"],
      now,
    });

    expect(registry.cores).toEqual([
      {
        coreId: "core-a",
        ownershipSource: "snapshot",
        maidenState: "eligible",
        maidenSource: "snapshot",
        profileStatus: "ready",
      },
    ]);
    expect(registry.unresolvedIdentityCount).toBe(2);
  });

  it("supports a manual-only Vault before the first snapshot", () => {
    const registry = buildCurrentVaultRegistry({
      snapshot: null,
      ownershipEdits: [ownershipEdit("add-a", "core-a", "add")],
      maidenOverrides: [
        maidenOverride(
          "me-a",
          "core-a",
          "eligible",
          "2026-07-22T00:00:00.000Z",
        ),
      ],
      knownCoreIds: ["core-a"],
      now,
    });

    expect(registry).toMatchObject({
      dataCurrentThrough: null,
      lastImportedAt: null,
      freshness: "unknown",
      cores: [
        {
          coreId: "core-a",
          ownershipSource: "manual",
          maidenState: "eligible",
          maidenSource: "manual_override",
          profileStatus: "ready",
        },
      ],
    });
  });

  it("applies manual add and remove edits chronologically", () => {
    const registry = buildCurrentVaultRegistry({
      snapshot: snapshot([
        {
          entryId: "entry-a",
          proposedCoreId: "core-a",
          confirmedCoreId: "core-a",
          maidenState: "not_eligible",
        },
      ]),
      ownershipEdits: [
        ownershipEdit("add-b", "core-b", "add", "2026-07-21T02:00:00.000Z"),
        ownershipEdit(
          "remove-a",
          "core-a",
          "remove",
          "2026-07-21T01:00:00.000Z",
        ),
      ],
      maidenOverrides: [],
      knownCoreIds: ["core-a", "core-b"],
      now,
    });

    expect(registry.cores.map(({ coreId }) => coreId)).toEqual(["core-b"]);
  });

  it("keeps pre-snapshot manual history auditable but superseded", () => {
    const registry = buildCurrentVaultRegistry({
      snapshot: snapshot([]),
      ownershipEdits: [
        ownershipEdit("old-add", "core-a", "add", "2026-07-19T00:00:00.000Z"),
      ],
      maidenOverrides: [
        maidenOverride(
          "old-me",
          "core-a",
          "eligible",
          "2026-07-19T00:00:00.000Z",
        ),
      ],
      knownCoreIds: ["core-a"],
      now,
    });

    expect(registry.cores).toEqual([]);
    expect(registry.supersededOwnershipEditCount).toBe(1);
    expect(registry.supersededMaidenOverrideCount).toBe(1);
  });

  it("applies ME overrides only to active cores and preserves warnings", () => {
    const registry = buildCurrentVaultRegistry({
      snapshot: snapshot([
        {
          entryId: "entry-a",
          proposedCoreId: "core-a",
          confirmedCoreId: "core-a",
          maidenState: "invalid",
        },
      ]),
      ownershipEdits: [],
      maidenOverrides: [
        maidenOverride("me-a", "core-a", "not_eligible"),
        maidenOverride("me-b", "core-b", "eligible"),
      ],
      knownCoreIds: ["core-a"],
      now,
    });

    expect(registry.cores[0]).toMatchObject({
      coreId: "core-a",
      maidenState: "not_eligible",
      maidenSource: "manual_override",
    });
    expect(registry.warnings).toContainEqual({
      code: "inactive_maiden_override",
      referenceId: "me-b",
      coreId: "core-b",
    });
  });

  it("keeps active cores with missing details visible as warnings", () => {
    const registry = buildCurrentVaultRegistry({
      snapshot: snapshot([]),
      ownershipEdits: [ownershipEdit("add-missing", "core-missing", "add")],
      maidenOverrides: [],
      knownCoreIds: [],
      now,
    });

    expect(registry.cores[0]?.profileStatus).toBe("missing_core_details");
    expect(registry.warnings).toContainEqual({
      code: "missing_core_details",
      referenceId: "core-missing",
      coreId: "core-missing",
    });
  });

  it("reports stale snapshot evidence independently from import time", () => {
    const registry = buildCurrentVaultRegistry({
      snapshot: {
        ...snapshot([]),
        dataCurrentThrough: "2026-07-10T00:00:00.000Z",
        lastImportedAt: "2026-07-22T00:00:00.000Z",
      },
      ownershipEdits: [],
      maidenOverrides: [],
      knownCoreIds: [],
      now,
    });

    expect(registry).toMatchObject({
      dataCurrentThrough: "2026-07-10T00:00:00.000Z",
      lastImportedAt: "2026-07-22T00:00:00.000Z",
      freshness: "stale",
    });
  });

  it("fails closed on duplicate confirmed ownership and is deterministic", () => {
    const duplicate = snapshot([
      {
        entryId: "entry-1",
        proposedCoreId: "core-a",
        confirmedCoreId: "core-a",
        maidenState: "eligible",
      },
      {
        entryId: "entry-2",
        proposedCoreId: "core-a",
        confirmedCoreId: "core-a",
        maidenState: "eligible",
      },
    ]);
    expect(() =>
      buildCurrentVaultRegistry({
        snapshot: duplicate,
        ownershipEdits: [],
        maidenOverrides: [],
        knownCoreIds: ["core-a"],
        now,
      }),
    ).toThrow("confirmed vault coreId must be unique");

    const edits = [
      ownershipEdit("add-b", "core-b", "add"),
      ownershipEdit("add-a", "core-a", "add"),
    ];
    const forward = buildCurrentVaultRegistry({
      snapshot: null,
      ownershipEdits: edits,
      maidenOverrides: [],
      knownCoreIds: ["core-a", "core-b"],
      now,
    });
    const reversed = buildCurrentVaultRegistry({
      snapshot: null,
      ownershipEdits: [...edits].reverse(),
      maidenOverrides: [],
      knownCoreIds: ["core-b", "core-a"],
      now,
    });
    expect(forward).toEqual(reversed);
  });

  it("projects ownership and Maiden events on one effective-time timeline", () => {
    const overrideBeforeAdd = buildCurrentVaultRegistry({
      snapshot: null,
      ownershipEdits: [
        ownershipEdit(
          "add-later",
          "core-a",
          "add",
          "2026-07-22T00:00:00.000Z",
        ),
      ],
      maidenOverrides: [
        maidenOverride(
          "override-earlier",
          "core-a",
          "eligible",
          "2026-07-21T00:00:00.000Z",
        ),
      ],
      knownCoreIds: ["core-a"],
      now,
    });

    expect(overrideBeforeAdd.cores).toEqual([
      {
        coreId: "core-a",
        ownershipSource: "manual",
        maidenState: "unknown",
        maidenSource: "unknown",
        profileStatus: "ready",
      },
    ]);
    expect(overrideBeforeAdd.warnings).toContainEqual({
      code: "inactive_maiden_override",
      referenceId: "override-earlier",
      coreId: "core-a",
    });

    const sameTimestamp = buildCurrentVaultRegistry({
      snapshot: null,
      ownershipEdits: [ownershipEdit("add-core", "core-a", "add")],
      maidenOverrides: [
        maidenOverride("set-maiden", "core-a", "eligible"),
      ],
      knownCoreIds: ["core-a"],
      now,
    });

    expect(sameTimestamp.cores[0]).toMatchObject({
      coreId: "core-a",
      maidenState: "eligible",
      maidenSource: "manual_override",
    });
    expect(sameTimestamp.warnings).toEqual([]);

    const validOverrideBeforeRemoval = buildCurrentVaultRegistry({
      snapshot: snapshot([
        {
          entryId: "entry-a",
          proposedCoreId: "core-a",
          confirmedCoreId: "core-a",
          maidenState: "unknown",
        },
      ]),
      ownershipEdits: [
        ownershipEdit(
          "remove-later",
          "core-a",
          "remove",
          "2026-07-22T00:00:00.000Z",
        ),
      ],
      maidenOverrides: [
        maidenOverride("override-active", "core-a", "eligible"),
      ],
      knownCoreIds: ["core-a"],
      now,
    });

    expect(validOverrideBeforeRemoval.cores).toEqual([]);
    expect(validOverrideBeforeRemoval.warnings).not.toContainEqual(
      expect.objectContaining({ code: "inactive_maiden_override" }),
    );
  });

  it("fails closed on unsupported manual actions and Maiden overrides", () => {
    expect(() =>
      buildCurrentVaultRegistry({
        snapshot: null,
        ownershipEdits: [
          {
            ...ownershipEdit("invalid-action", "core-a", "add"),
            action: "archive" as ManualOwnershipEdit["action"],
          },
        ],
        maidenOverrides: [],
        knownCoreIds: ["core-a"],
        now,
      }),
    ).toThrow("Invalid ownership action for invalid-action");

    expect(() =>
      buildCurrentVaultRegistry({
        snapshot: null,
        ownershipEdits: [ownershipEdit("add-a", "core-a", "add")],
        maidenOverrides: [
          {
            ...maidenOverride("invalid-me", "core-a", "eligible"),
            maidenState: "invalid" as ManualMaidenOverride["maidenState"],
          },
        ],
        knownCoreIds: ["core-a"],
        now,
      }),
    ).toThrow("Invalid Maiden override for invalid-me");
  });
});
