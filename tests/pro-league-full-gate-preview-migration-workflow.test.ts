import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Pro League full-gate Preview migration workflow", () => {
  it("binds exact main to the approved bounded Preview and rollback", async () => {
    const workflow = await readFile(
      ".github/workflows/pro-league-full-gate-preview-migration.yml",
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("apply_private_preview_migration:");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain("--role-name neondb_owner");
    expect(workflow).toContain("rollback() {");
    expect(workflow).toContain("0152_pro_league_full_gate_persistence.up.sql");
    expect(workflow).toContain(
      "0152_pro_league_full_gate_persistence.smoke.sql",
    );
    expect(workflow).toContain(
      "0152_pro_league_full_gate_persistence.down.sql",
    );
    expect(workflow).toContain(
      "0152_pro_league_full_gate_persistence.removal.sql",
    );
    for (const identity of [
      "fancy-bar-26534950",
      "br-floral-haze-a7bvs9lu",
      "ep-misty-paper-a796pgn0",
      "neondb",
      "dna_app_runtime",
      "autoscaling_limit_min_cu !== 0.25",
      "autoscaling_limit_max_cu !== 0.25",
      "suspend_timeout_seconds !== 0",
      'typeof matches[0]?.suspended_at !== "string"',
    ]) {
      expect(workflow).toContain(identity);
    }
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).not.toMatch(
      /echo .*"\$\{(?:DATABASE_URL|NEON_API_KEY|NEON_PROJECT_ID)\}"|printenv|env\s*$/mu,
    );
  });

  it("keeps owner dispatch exact-main and allow-listed", async () => {
    const relay = await readFile(
      ".github/workflows/dna-owner-dispatch-relay.yml",
      "utf8",
    );
    expect(relay).toContain('case "pro-league-full-gate-preview-migration":');
    expect(relay).toContain(
      'workflow = "pro-league-full-gate-preview-migration.yml";',
    );
    expect(relay).toContain("apply_private_preview_migration: true");
  });
});
