import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/tournament-vault-core-state-preview-migration.yml";

describe("Tournament Vault Core state Preview migration workflow", () => {
  it("is exact-main, Preview-only, explicitly armed and recoverable", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("exact_main_sha:");
    expect(workflow).toContain("apply_private_preview_migration:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      '[[ "${EXPECTED_MAIN_SHA}" != "${GITHUB_SHA}" ]]',
    );
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain("0148_tournament_vault_core_state_read.up.sql");
    expect(workflow).toContain(
      "0148_tournament_vault_core_state_read.smoke.sql",
    );
    expect(workflow).toContain(
      "0148_tournament_vault_core_state_read.down.sql",
    );
    expect(workflow).toContain(
      "0148_tournament_vault_core_state_read.removal.sql",
    );
    expect(workflow).toContain(
      "Tournament Vault Core state read is not absent",
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain("NEON_API_KEY: ${{ secrets.NEON_API_KEY }}");
    expect(workflow).toContain(
      "NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}",
    );
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).toContain("DNA_MIGRATION_DATABASE_URL=${migration_url}");
    expect(workflow).toContain('psql "${DNA_MIGRATION_DATABASE_URL}"');
    expect(workflow).toContain("DNA_MIGRATION_DATABASE_URL=");
    expect(workflow).not.toMatch(
      /echo .*"\$\{(?:DATABASE_URL|NEON_API_KEY|NEON_PROJECT_ID)\}"|printenv|env\s*$/mu,
    );
  });
});
