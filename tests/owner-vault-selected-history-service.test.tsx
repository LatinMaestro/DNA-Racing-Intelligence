import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OwnerVaultWorkspace } from "../components/owner-vault-workspace";
import type { ActiveSelectedDnaCoreRaceHistoryReadRepository } from "../lib/neon-active-dna-core-race-history-generation";
import type { OwnerVaultCataloguePageState } from "../lib/owner-vault-catalogue-service";
import { loadOwnerVaultSelectedHistory } from "../lib/owner-vault-selected-history-service";

const ownerId = "user_owner";
const core = {
  sourceCoreId: "10457",
  displayName: "Accepted Core",
  coreClass: "Genesis" as const,
  element: "Fire" as const,
  fNumber: 2,
  sex: "female" as const,
  inMyVault: true,
  meEligible: null,
  version: null,
  updatedAt: null,
  source: "accepted_owner_api_snapshot" as const,
};
const catalogue: OwnerVaultCataloguePageState = {
  connectionStatus: "connected",
  filters: {
    scope: "vault",
    query: null,
    element: null,
    coreClass: null,
    sex: null,
    fNumber: null,
  },
  cores: [core],
  coverage: "accepted_owner_api_snapshot",
  apiSnapshot: {
    generationId: "11111111-1111-4111-8111-111111111111",
    coreCount: 214,
    oldestObservedAt: "2026-09-10T00:00:00.000Z",
    newestObservedAt: "2026-10-01T00:00:00.000Z",
  },
};
const joined = {
  generationId: "a".repeat(64),
  ordinal: 7,
  naturalKey: "core-result:10457:race-9",
  rowSha256: "c".repeat(64),
  payload: {
    sourceType: "joined_core_race_history_result",
    naturalKey: "core-result:10457:race-9",
    resultEvidenceSha256: "d".repeat(64),
    raceDocumentEvidenceSha256: "e".repeat(64),
    raceDocumentObservedAt: "2026-09-29T01:30:00.000Z",
    sourceCoreId: "10457",
    sourceRaceId: "race-9",
    mode: "bike",
    distanceMetres: 2300,
    distanceAuthority: "result_and_race_document",
    elapsedMilliseconds: 137810,
    finishPosition: 4,
    eventAt: "2026-09-29T01:00:00.000Z",
    gateCount: 6,
    payoutMechanismSourceValue: null,
    sourceFormat: "normal",
    sourceRaceClass: null,
    goldStar: null,
    blueStar: null,
    starEvidenceStatus: "missing",
    publishedCellStatus: "unsupported_format",
    raceType: null,
    mapIds: [],
  },
};
function fixture() {
  const readActiveGeneration = vi.fn(async () => ({
    generationId: "a".repeat(64),
    observationSetSha256: "b".repeat(64),
    publishedAt: "2026-09-30T00:00:00.000Z",
    observationCount: 101575,
  }));
  const readSelectedCoreRows = vi.fn(async () => ({
    status: "ready" as const,
    rows: [joined],
  }));
  const repository = {
    readActiveGeneration,
    readSelectedCoreRows,
  } as unknown as ActiveSelectedDnaCoreRaceHistoryReadRepository;
  return { repository, readActiveGeneration, readSelectedCoreRows };
}

describe("My Vault selected accepted history", () => {
  it("renders bounded exact-source history for one owned Core", async () => {
    const f = fixture();
    const state = await loadOwnerVaultSelectedHistory({
      catalogue,
      selectedCoreId: "10457",
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      acceptedHistoryRepository: f.repository,
    });
    expect(f.readActiveGeneration).toHaveBeenCalledWith(ownerId);
    expect(f.readSelectedCoreRows).toHaveBeenCalledWith(ownerId, {
      generationId: "a".repeat(64),
      observationSetSha256: "b".repeat(64),
      coreIds: ["10457"],
      maximumRows: 1000,
    });
    expect(state.acceptedHistory?.acceptedHistoryStatus).toBe("connected");
    const html = renderToStaticMarkup(
      <OwnerVaultWorkspace state={catalogue} selectedHistory={state} />,
    );
    expect(html).toContain("Accepted race history");
    expect(html).toContain("2,300");
    expect(html).toContain("6");
    expect(html).toContain("normal");
    expect(html).toContain("Unavailable: unsupported format");
    expect(html).toContain("c".repeat(64));
    expect(html).not.toContain("ME eligible</dd>");
  });

  it("never reads absent, unowned, or filtered-out selections", async () => {
    const f = fixture();
    const unowned = { ...catalogue, cores: [{ ...core, inMyVault: false }] };
    for (const selection of [
      { catalogue, selectedCoreId: undefined },
      { catalogue, selectedCoreId: "104570" },
      { catalogue: unowned, selectedCoreId: "10457" },
      {
        catalogue: { ...catalogue, connectionStatus: "read_failed" as const },
        selectedCoreId: "10457",
      },
    ]) {
      const state = await loadOwnerVaultSelectedHistory({
        ...selection,
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        acceptedHistoryRepository: f.repository,
      });
      expect(state.acceptedHistory).toBeNull();
    }
    expect(f.readActiveGeneration).not.toHaveBeenCalled();
    expect(f.readSelectedCoreRows).not.toHaveBeenCalled();
  });

  it("rejects cross-owner reads and preserves unknown sources", async () => {
    const f = fixture();
    await expect(
      loadOwnerVaultSelectedHistory({
        catalogue,
        selectedCoreId: "10457",
        authenticatedOwnerId: "other_owner",
        configuredOwnerId: ownerId,
        acceptedHistoryRepository: f.repository,
      }),
    ).rejects.toThrow("access denied");
    expect(f.readActiveGeneration).not.toHaveBeenCalled();

    const selected = await loadOwnerVaultSelectedHistory({
      catalogue,
      selectedCoreId: "10457",
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      acceptedHistoryRepository: null,
    });
    expect(selected.acceptedHistory?.acceptedHistoryStatus).toBe(
      "not_connected",
    );
  });
});
