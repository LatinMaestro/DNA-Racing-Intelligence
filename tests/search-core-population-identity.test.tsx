import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SearchCoreWorkspace } from "@/components/search-core-workspace";
import type { SearchCorePageState } from "@/lib/search-core-service";

function state(
  overrides: Partial<SearchCorePageState> = {},
): SearchCorePageState {
  return {
    connectionStatus: "connected",
    query: "9002",
    results: [],
    selectedCore: null,
    populationIdentityStatus: "connected",
    populationIdentity: {
      sourceCoreId: "9002",
      generationId: "22222222-2222-4222-8222-222222222222",
      evaluatedAt: "2026-10-06T05:02:00.000Z",
      coreSetSha256: "a".repeat(64),
      populationCoreCount: 4_096,
    },
    performanceStatus: "not_connected",
    performanceProfiles: [],
    performanceLastImportedAt: null,
    acceptedHistoryStatus: "not_connected",
    acceptedHistoryGeneration: null,
    acceptedHistoryRows: [],
    archiveHistoryStatus: "not_connected",
    archiveHistoryVersionCount: 0,
    archiveHistoryPartitionCount: 0,
    archiveHistoryRowCount: 0,
    ...overrides,
  };
}

describe("Search Core population identity", () => {
  it("shows exact accepted population membership and keeps missing metadata unavailable", () => {
    const html = renderToStaticMarkup(<SearchCoreWorkspace state={state()} />);
    expect(html).toContain("1 core shown");
    expect(html).toContain("Accepted population identity");
    expect(html).toContain("Core ID 9002");
    expect(html).toContain("4,096 Core IDs");
    expect(html).toContain("Profile metadata");
    expect(html).toContain("Unavailable");
    expect(html).toContain("are not stored");
    expect(html).not.toContain("Genesis");
    expect(html).not.toContain("In My Vault");
  });

  it("fails closed when exact population authority cannot be verified", () => {
    const html = renderToStaticMarkup(
      <SearchCoreWorkspace
        state={state({
          populationIdentityStatus: "unavailable",
          populationIdentity: null,
        })}
      />,
    );
    expect(html).toContain("could not be verified");
    expect(html).toContain("No population result is substituted");
    expect(html).toContain('role="alert"');
  });
});
