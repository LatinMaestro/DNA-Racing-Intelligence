import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportWorkspacePanel } from "@/components/import-workspace";
import { buildImportWorkspace } from "@/domain/import-workflow";
import type { ImportWorkspaceConnectionStatus } from "@/lib/import-workspace-service";

function render(connectionStatus: ImportWorkspaceConnectionStatus): string {
  return renderToStaticMarkup(
    <ImportWorkspacePanel
      connectionStatus={connectionStatus}
      rollbackActionStatus="not_configured"
      workspace={buildImportWorkspace([], new Date("2026-07-24T08:00:00.000Z"))}
    />,
  );
}

describe("import workspace connection boundary", () => {
  it.each([
    ["identity_not_connected", "Owner identity not connected"],
    ["persistence_not_configured", "Private status storage not connected"],
    ["read_failed", "Private import status unavailable"],
    ["integrity_failed", "Private import status failed validation"],
    ["read_model_connected", "Historical status connected"],
  ] as const)(
    "renders the %s state without private identifiers",
    (state, copy) => {
      const markup = render(state);

      expect(markup).toContain(copy);
      expect(markup).toContain("disabled");
      expect(markup).not.toContain("configured-owner");
      expect(markup).not.toContain("synthetic-batch");
    },
  );

  it.each(["read_failed", "integrity_failed"] as const)(
    "withholds receipt and queue absence claims for %s",
    (connectionStatus) => {
      const markup = render(connectionStatus);

      expect(markup).toContain("Import status withheld");
      expect(markup).toContain(
        "Unknown does not mean that a source was never imported",
      );
      expect(markup).toContain("Recent import evidence is unavailable");
      expect(markup).toContain("Recovery and review status is unavailable");
      expect(markup).not.toContain("No private import has been accepted");
      expect(markup).not.toContain("Nothing is queued");
      expect(markup).not.toContain("not imported");
    },
  );
});
