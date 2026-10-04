import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-imports-dataset-version-read-preview-migration.yml";

describe("Imports dataset-version Preview migration workflow", () => {
  it("is exact-main, Preview-only, read-only and reversible", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("exact_main_sha:");
    expect(workflow).toContain("apply_private_preview_migration:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "0124_import_workspace_dataset_version_read.up.sql",
    );
    expect(workflow).toContain(
      "0124_import_workspace_dataset_version_read.smoke.sql",
    );
    expect(workflow).toContain(
      "0124_import_workspace_dataset_version_read.down.sql",
    );
    expect(workflow).toContain(
      "0124_import_workspace_dataset_version_read.removal.sql",
    );
    expect(workflow).toContain(
      "'dna_app_runtime', 'dna.dataset_version', 'INSERT,UPDATE,DELETE'",
    );
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).not.toMatch(/production/iu);
  });
});
