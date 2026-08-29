import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-open-lab-p5-capacity-measurement.yml";

describe("DNA Open Lab P5 capacity measurement workflow", () => {
  it("is exact-main, dispatch-only, rollback-only and cleanup-gated", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch: {}");
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      "tests/hosted-preview-connected-p5-provider-prerequisites.test.ts",
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-p5-capacity-measurement.test.ts",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      "steps.capacity.outcome == 'success' && steps.cleanup.outcome == 'success'",
    );
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).not.toMatch(/DNA_OPEN_LAB_API_KEY|VERCEL|production/iu);
  });
});
