import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/pro-league-api-evidence-private-publication.yml";

describe("Pro League API evidence private publication workflow", () => {
  it("is exact-main, private, one-shot and fail-closed", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain(`- "${workflowPath}"`);
    expect(workflow).not.toMatch(/\b(pull_request|schedule):/u);
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain("execute_private_preview_publication");
    expect(workflow).toContain(
      "tests/hosted-preview-connected-pro-league-api-evidence-publication-command.test.ts",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY|DNA_R2_/u);
  });
});
