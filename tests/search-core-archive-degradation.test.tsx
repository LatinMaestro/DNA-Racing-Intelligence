import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SearchCoreWorkspace } from "@/components/search-core-workspace";
import type { SearchCorePageState } from "@/lib/search-core-service";

const core: NonNullable<SearchCorePageState["selectedCore"]> = {
  sourceCoreId: "synthetic-core-7",
  displayName: "Synthetic Seven",
  coreClass: "Genesis",
  element: "Fire",
  fNumber: 2,
  sex: "female",
  inMyVault: false,
  meEligible: false,
  version: 0,
  updatedAt: null,
};

describe("Search Core optional archive failure", () => {
  it("reports unknown archive coverage while retaining the selected Core", () => {
    const state: SearchCorePageState = {
      connectionStatus: "connected",
      query: "Synthetic",
      results: [core],
      selectedCore: core,
      performanceStatus: "not_connected",
      performanceProfiles: [],
      performanceLastImportedAt: null,
      archiveHistoryStatus: "unavailable",
      archiveHistoryVersionCount: 0,
      archiveHistoryPartitionCount: 0,
      archiveHistoryRowCount: 0,
    };
    const html = renderToStaticMarkup(<SearchCoreWorkspace state={state} />);

    expect(html).toContain("Synthetic Seven");
    expect(html).toContain('role="alert"');
    expect(html).toContain("coverage is unknown, not zero");
    expect(html).toContain("separately accepted");
    expect(html).toContain(
      "Historical performance profiles are not configured",
    );
    expect(html).not.toContain("Verified rows");
    expect(html).not.toContain("R2 partitions read");
  });
});
