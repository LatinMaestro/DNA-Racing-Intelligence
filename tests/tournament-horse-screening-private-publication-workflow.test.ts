import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/tournament-horse-screening-private-publication.yml";

describe("Tournament Horse screening private publication workflow", () => {
  it("is manual-only, exact-main, private and triply armed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain("daily_cost_clearance_confirmed");
    expect(workflow).toContain("private_r2_read_budget_confirmed");
    expect(workflow).toContain("execute_private_preview_publication");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-tournament-horse-screening-publication-command.test.ts",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY/u);
    for (const setting of [
      "AUTHORIZED_CLERK_USER_ID",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "DATABASE_URL",
      "DNA_DATABASE_OWNER_ID",
      "DNA_R2_ACCESS_KEY_ID",
      "DNA_R2_BUCKET_NAME",
      "DNA_R2_SECRET_ACCESS_KEY",
    ]) {
      expect(workflow).toContain(setting);
    }
  });
});
