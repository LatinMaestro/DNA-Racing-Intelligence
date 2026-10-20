import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Vault Performance Preview workflows", () => {
  it("keeps connected verification exact-main and read-only", async () => {
    const workflow = await readFile(
      ".github/workflows/vault-performance-private-preview-verification.yml",
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "hosted-preview-connected-vault-performance-commissioning.test.tsx",
    );
    for (const identity of [
      "fancy-bar-26534950",
      "br-floral-haze-a7bvs9lu",
      "ep-misty-paper-a796pgn0",
      "neondb",
    ]) {
      expect(workflow).toContain(identity);
    }
    expect(workflow).toContain('branch_id}" != "${APPROVED_NEON_BRANCH_ID}');
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });

  it("installs the complete reviewed set with rollback and removal gates", async () => {
    const workflow = await readFile(
      ".github/workflows/vault-performance-preview-migrations.yml",
      "utf8",
    );
    for (const migration of ["0125", "0126", "0132", "0133"]) {
      expect(workflow).toContain(`${migration}_`);
      expect(workflow).toContain(`${migration}_`);
    }
    expect(workflow).toContain("apply_private_preview_migrations:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).toContain("rollback() {");
    expect(workflow).toContain("DNA_MIGRATION_DATABASE_URL=");
    for (const identity of [
      "fancy-bar-26534950",
      "br-floral-haze-a7bvs9lu",
      "ep-misty-paper-a796pgn0",
      "neondb",
    ]) {
      expect(workflow).toContain(identity);
    }
    expect(workflow).toContain('branch_id}" != "${APPROVED_NEON_BRANCH_ID}');
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).not.toMatch(
      /echo .*"\$\{(?:DATABASE_URL|NEON_API_KEY|NEON_PROJECT_ID)\}"|printenv|env\s*$/mu,
    );
  });
});
