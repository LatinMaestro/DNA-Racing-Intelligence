import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImportWorkspacePanel } from "@/components/import-workspace";
import {
  loadImportWorkspacePageState,
  type ImportBatchRepository,
} from "@/lib/import-workspace-service";

describe("empty connected import recovery workspace", () => {
  it("replays an owner-scoped empty repository through the service and UI without inventing recovery", async () => {
    const listBatchesByOwner = vi.fn(async () => []);
    const repository: ImportBatchRepository = {
      status: "ready",
      listBatchesByOwner,
    };

    const state = await loadImportWorkspacePageState({
      authenticatedOwnerId: "configured-owner",
      configuredOwnerId: "configured-owner",
      repository,
      now: new Date("2026-10-29T00:00:00.000Z"),
    });

    const markup = renderToStaticMarkup(
      <ImportWorkspacePanel
        aggregateRetryActionStatus="ready"
        connectionStatus={state.connectionStatus}
        rollbackActionStatus="ready"
        workspace={state.workspace}
      />,
    );

    expect(listBatchesByOwner).toHaveBeenCalledExactlyOnceWith(
      "configured-owner",
    );
    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.workspace.recentBatches).toEqual([]);
    expect(state.workspace.recoveryQueue).toEqual([]);
    expect(markup).toContain("No private import has been accepted");
    expect(markup).toContain("No private update progress is available");
    expect(markup).toContain("Nothing is queued");
    expect(markup).not.toContain("Restore prior accepted dataset");
    expect(markup).not.toContain("Retry aggregate refresh");
    expect(markup).not.toContain("0 accepted");
  });
});
