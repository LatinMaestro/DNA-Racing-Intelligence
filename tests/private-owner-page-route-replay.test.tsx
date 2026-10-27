import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatedClerkOwnerId: vi.fn(),
  catalogueRepository: { status: "ready" as const },
  historyRepository: { status: "ready" as const },
  performanceRepository: { status: "ready" as const },
  loadCatalogue: vi.fn(),
  loadSelectedHistory: vi.fn(),
  loadSearchCore: vi.fn(),
}));

vi.mock("@/lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: mocks.authenticatedClerkOwnerId,
}));
vi.mock("@/lib/owner-vault-api-catalogue-repository", () => ({
  ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment: () =>
    mocks.catalogueRepository,
}));
vi.mock("@/lib/neon-active-dna-core-race-history-generation", () => ({
  neonActiveDnaCoreRaceHistoryGenerationReadRepositoryFromEnvironment: () =>
    mocks.historyRepository,
}));
vi.mock("@/lib/neon-core-performance-profile-repository", () => ({
  neonCorePerformanceProfileRepositoryFromEnvironment: () =>
    mocks.performanceRepository,
}));
vi.mock("@/lib/hosted-race-archive-core-history-runtime", () => ({
  hostedRaceArchiveCoreHistoryRuntime: () => ({
    status: "not_configured" as const,
  }),
}));
vi.mock("@/lib/owner-vault-catalogue-service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/owner-vault-catalogue-service")
  >()),
  loadOwnerVaultCataloguePageState: mocks.loadCatalogue,
}));
vi.mock("@/lib/owner-vault-selected-history-service", () => ({
  loadOwnerVaultSelectedHistory: mocks.loadSelectedHistory,
}));
vi.mock("@/lib/search-core-service", () => ({
  loadSearchCorePageState: mocks.loadSearchCore,
}));

import SearchCorePage from "@/app/(private)/search-core/page";
import VaultPage from "@/app/(private)/vault/page";

const ownerId = "owner-preview";
const core = {
  sourceCoreId: "10457",
  displayName: "Core 10457",
  coreClass: "Genesis" as const,
  element: "Metal" as const,
  fNumber: 1,
  sex: "male" as const,
  inMyVault: true,
  meEligible: null,
  version: null,
  updatedAt: null,
  source: "accepted_owner_api_snapshot" as const,
};
const historyRow = {
  generationId: "a".repeat(64),
  ordinal: 0,
  naturalKey: "core-result:10457:bike:race-10457",
  rowSha256: "b".repeat(64),
  payload: {
    sourceType: "joined_core_race_history_result" as const,
    naturalKey: "core-result:10457:bike:race-10457",
    resultEvidenceSha256: "c".repeat(64),
    raceDocumentEvidenceSha256: "d".repeat(64),
    raceDocumentObservedAt: "2026-09-30T00:00:00.000Z",
    sourceCoreId: "10457",
    sourceRaceId: "race-10457",
    mode: "bike" as const,
    distanceMetres: 1_000,
    distanceAuthority: "result_and_race_document" as const,
    elapsedMilliseconds: 60_123,
    finishPosition: 2,
    eventAt: "2026-09-29T00:00:00.000Z",
    gateCount: 6,
    payoutMechanismSourceValue: null,
    sourceFormat: "normal",
    sourceRaceClass: null,
    goldStar: null,
    blueStar: null,
    starEvidenceStatus: "missing" as const,
    publishedCellStatus: "unsupported_format" as const,
    raceType: null,
    mapIds: [],
  },
};
const acceptedHistory = {
  acceptedHistoryStatus: "connected" as const,
  acceptedHistoryGeneration: {
    generationId: "a".repeat(64),
    observationSetSha256: "e".repeat(64),
    publishedAt: "2026-10-01T00:00:00.000Z",
    observationCount: 1,
  },
  acceptedHistoryRows: [historyRow],
};

describe("private owner page route replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", ownerId);
    vi.stubEnv("DNA_DATABASE_OWNER_ID", ownerId);
    vi.stubEnv("DNA_DATABASE_RUNTIME_ROLE", "dna_app_runtime");
    mocks.authenticatedClerkOwnerId.mockResolvedValue(ownerId);
  });

  it("executes the authenticated Vault route without a duplicate history read", async () => {
    const catalogue = {
      connectionStatus: "connected" as const,
      filters: {
        scope: "vault" as const,
        query: "10457",
        element: null,
        coreClass: null,
        sex: null,
        fNumber: null,
      },
      cores: [core],
      coverage: "accepted_owner_api_snapshot" as const,
      apiSnapshot: {
        generationId: "11111111-1111-4111-8111-111111111111",
        coreCount: 214,
        oldestObservedAt: "2026-09-01T00:00:00.000Z",
        newestObservedAt: "2026-10-01T00:00:00.000Z",
      },
    };
    mocks.loadCatalogue.mockResolvedValue(catalogue);
    const html = renderToStaticMarkup(
      await VaultPage({
        searchParams: Promise.resolve({ q: "10457", coreId: "10457" }),
      }),
    );

    expect(mocks.authenticatedClerkOwnerId).toHaveBeenCalledOnce();
    expect(mocks.loadCatalogue).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: mocks.catalogueRepository,
        filters: expect.objectContaining({ query: "10457" }),
      }),
    );
    expect(mocks.loadSelectedHistory).not.toHaveBeenCalled();
    expect(html).toContain("Accepted owner API snapshot");
    expect(html).toContain("214 current owner Cores");
    expect(html).toContain("View core");
    expect(html).toContain(
      'href="/search-core?q=10457&amp;coreId=10457#selected-core"',
    );
    expect(html).not.toContain("Accepted race history");
  });

  it("executes Search Core with exact Bike filters and owner-scoped repositories", async () => {
    mocks.loadSearchCore.mockResolvedValue({
      connectionStatus: "connected" as const,
      query: "10457",
      results: [core],
      selectedCore: core,
      performanceStatus: "not_connected" as const,
      performanceProfiles: [],
      performanceLastImportedAt: null,
      performancePublication: null,
      ...acceptedHistory,
      archiveHistoryStatus: "not_connected" as const,
      archiveHistoryVersionCount: 0,
      archiveHistoryPartitionCount: 0,
      archiveHistoryRowCount: 0,
    });

    const html = renderToStaticMarkup(
      await SearchCorePage({
        searchParams: Promise.resolve({
          q: "10457",
          coreId: "10457",
          mode: "bike",
          distance: "1000",
        }),
      }),
    );

    expect(mocks.authenticatedClerkOwnerId).toHaveBeenCalledOnce();
    expect(mocks.loadSearchCore).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: mocks.catalogueRepository,
        performanceRepository: mocks.performanceRepository,
        acceptedHistoryRepository: mocks.historyRepository,
        query: "10457",
        selectedCoreId: "10457",
      }),
    );
    expect(html).toContain("Core 10457");
    expect(html).toContain("Bike");
    expect(html).toContain("1,000 m");
    expect(html).toContain("60.123 s");
    expect(html).toContain("Unavailable: unsupported format");
    expect(html).not.toContain("Accepted analytical cell");
  });
});
