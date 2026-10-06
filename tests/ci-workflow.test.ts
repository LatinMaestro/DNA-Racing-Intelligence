import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/ci.yml";

describe("CI workflow", () => {
  it("supports an owner-relayed exact-main fallback without weakening automatic CI", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain('"${GITHUB_REF}" != "refs/heads/main"');
    expect(workflow).toContain(
      '"${{ inputs.expected_main_sha }}" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain(
      '"$(git rev-parse origin/main)" != "${GITHUB_SHA}"',
    );
    expect(workflow).toContain("Audit production dependencies");
    expect(workflow).toContain("npm run worker:dry-run");
    expect(workflow).toContain("Apply data-foundation migration");
    expect(workflow).toContain("Reverse data-foundation migration");
  });
});
