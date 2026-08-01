import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VaultWorkspace } from "@/components/vault-workspace";
import { buildCurrentVaultRegistry } from "@/domain/vault-registry";
import type { VaultWorkspaceConnectionStatus } from "@/lib/vault-workspace-service";

const now = new Date("2026-07-24T08:00:00.000Z");

function render(connectionStatus: VaultWorkspaceConnectionStatus): string {
  return renderToStaticMarkup(
    <VaultWorkspace
      connectionStatus={connectionStatus}
      registry={buildCurrentVaultRegistry({
        snapshot: null,
        ownershipEdits: [],
        maidenOverrides: [],
        knownCoreIds: [],
        now,
      })}
    />,
  );
}

describe("Vault workspace presentation", () => {
  it.each([
    ["identity_not_connected", "Owner identity not connected"],
    ["persistence_not_configured", "Private Vault storage not connected"],
    ["read_model_connected", "Historical Vault snapshot connected"],
  ] as const)("renders the %s boundary safely", (status, copy) => {
    const markup = render(status);

    expect(markup).toContain(copy);
    expect(markup).toContain("disabled");
    expect(markup).toContain("not represent live game availability");
    expect(markup).not.toContain("configured-owner");
  });

  it("shows durable-ID ownership, separate Maiden state and semantic timestamps", () => {
    const markup = renderToStaticMarkup(
      <VaultWorkspace
        connectionStatus="read_model_connected"
        registry={buildCurrentVaultRegistry({
          snapshot: {
            snapshotId: "snapshot",
            dataCurrentThrough: "2026-07-23T00:00:00.000Z",
            lastImportedAt: "2026-07-23T01:00:00.000Z",
            entries: [
              {
                entryId: "entry-1",
                proposedCoreId: null,
                confirmedCoreId: "core-1",
                maidenState: "eligible",
              },
              {
                entryId: "entry-2",
                proposedCoreId: null,
                confirmedCoreId: "core-2",
                maidenState: "not_eligible",
              },
            ],
          },
          ownershipEdits: [],
          maidenOverrides: [],
          knownCoreIds: ["core-1"],
          now,
        })}
      />,
    );

    expect(markup).toContain("core-1");
    expect(markup).toContain("core-2");
    expect(markup).toContain("ME eligible");
    expect(markup).toContain("Not ME eligible");
    expect(markup).toContain("missing core details");
    expect(markup).toContain("Data current through");
    expect(markup).toContain("Last imported");
    expect(markup).toContain('dateTime="2026-07-23T00:00:00.000Z"');
    expect(markup).toContain('dateTime="2026-07-23T01:00:00.000Z"');
  });
});
