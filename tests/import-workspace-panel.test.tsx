import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportWorkspacePanel } from "@/components/import-workspace";
import { buildImportWorkspace } from "@/domain/import-workflow";
import type { ImportWorkspaceConnectionStatus } from "@/lib/import-workspace-service";

function render(connectionStatus: ImportWorkspaceConnectionStatus): string {
  return renderToStaticMarkup(
    <ImportWorkspacePanel
      connectionStatus={connectionStatus}
      workspace={buildImportWorkspace([], new Date("2026-07-24T08:00:00.000Z"))}
    />,
  );
}

describe("import workspace connection boundary", () => {
  it.each([
    ["identity_not_connected", "Owner identity not connected"],
    ["persistence_not_configured", "Private status storage not connected"],
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
});
