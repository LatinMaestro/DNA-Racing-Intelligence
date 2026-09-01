import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-open-lab-p5-first-backfill-measurement.yml";

describe("DNA Open Lab P5 first-backfill measurement workflow", () => {
  it("is exact-main, dispatch-only, recovery-first and non-persistent", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("commissioning_requests_per_minute:");
    expect(workflow).toContain('default: "30"');
    expect(workflow).toContain('          - "150"');
    expect(workflow).toContain("approve_temporary_150_rpm:");
    expect(workflow).toContain(
      'requestsPerMinute === "150" && temporaryApproval === "true"',
    );
    expect(workflow).not.toMatch(/\b(push|pull_request|schedule):/u);
    expect(workflow).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-p5-crash-replay-recovery.test.ts",
    );
    expect(workflow).toContain(
      "tests/hosted-preview-connected-p5-first-backfill-measurement.test.ts",
    );
    expect(workflow).toContain("steps.recovery_cleanup.outcome == 'success'");
    expect(workflow).toContain("steps.exact_main.outcome == 'success'");
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).not.toMatch(/VERCEL|production/iu);
  });
});
