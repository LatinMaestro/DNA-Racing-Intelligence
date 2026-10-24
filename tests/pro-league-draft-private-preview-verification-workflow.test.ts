import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/pro-league-draft-private-preview-verification.yml";

describe("Pro League draft private Preview verification workflow", () => {
  it("is exact-main, explicitly armed, private and fail-closed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain(`- "${workflowPath}"`);
    expect(workflow).not.toMatch(/\b(pull_request|schedule):/u);
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain("execute_private_preview_verification");
    expect(workflow).toContain("persist_owner_confirmed_plan");
    expect(workflow).toContain("PRO_LEAGUE_OWNER_CONFIRMED_PERSISTENCE");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-pro-league-draft-commissioning.test.ts",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      "EXPECTED_DATABASE_ENDPOINT: ep-misty-paper-a796pgn0",
    );
    expect(workflow).toContain("EXPECTED_DATABASE_NAME: neondb");
    expect(workflow).toContain("EXPECTED_DATABASE_ROLE: dna_app_runtime");
    expect(workflow).toContain(
      "Attest approved Preview database session without exposure",
    );
    expect(workflow).toContain("dna.read_pro_league_roster_version(uuid,text)");
    expect(workflow).toContain(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(workflow).toContain("commissioning-missing-probe");
    expect(workflow).not.toMatch(/console\.log\([^)]*process\.env/u);
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY|DNA_R2_/u);
    expect(workflow).toContain("default: false");
  });
});
