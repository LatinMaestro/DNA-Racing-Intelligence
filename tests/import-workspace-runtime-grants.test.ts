import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-import-workspace-runtime-grants-preview-migration.yml";
const migrationPrefix =
  "database/migrations/0124_import_workspace_runtime_read_grants";

describe("Import workspace runtime grants", () => {
  it("keeps the Preview apply exact-main, owner-armed and reversible", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("exact_main_sha:");
    expect(workflow).toContain("apply_private_preview_migration:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "0124_import_workspace_runtime_read_grants.up.sql",
    );
    expect(workflow).toContain(
      "0124_import_workspace_runtime_read_grants.smoke.sql",
    );
    expect(workflow).toContain(
      "0124_import_workspace_runtime_read_grants.down.sql",
    );
    expect(workflow).toContain(
      "0124_import_workspace_runtime_read_grants.removal.sql",
    );
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).toContain("set -euo pipefail");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY/u);
  });

  it("grants only owner-scoped read access needed by the import workspace", async () => {
    const [up, smoke, down, removal] = await Promise.all(
      ["up", "smoke", "down", "removal"].map((suffix) =>
        readFile(`${migrationPrefix}.${suffix}.sql`, "utf8"),
      ),
    );

    for (const relation of [
      "dna.dataset_version",
      "dna.import_warning",
      "dna.identity_review",
      "dna.manual_star_observation",
    ]) {
      expect(up).toContain(relation);
      expect(smoke).toContain(relation);
      expect(down).toContain(relation);
      expect(removal).toContain(relation);
    }
    expect(up).toContain("GRANT SELECT ON TABLE");
    expect(up).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/u);
    expect(smoke).toContain("relrowsecurity");
    expect(smoke).toContain("relforcerowsecurity");
    expect(down).toContain("REVOKE SELECT ON TABLE");
  });
});
