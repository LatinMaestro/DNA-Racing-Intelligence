import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("DNA runtime status surfaces", () => {
  it("keeps one current-main CI status and one population status comment", async () => {
    const [workflow, script] = await Promise.all([
      readFile(".github/workflows/dna-ci-status-relay.yml", "utf8"),
      readFile(".github/scripts/update-dna-runtime-status.mjs", "utf8"),
    ]);

    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain('workflows: ["CI"]');
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain(
      "github.event.workflow_run.head_branch == 'main'",
    );
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain('DNA_STATUS_COMMENT_ID: "5866846183"');
    expect(workflow).not.toMatch(/VERCEL|production/iu);

    expect(script).toContain("<!-- dna-ci-status -->");
    expect(script).toContain("<!-- dna-population-status -->");
    expect(script).toContain("/issues/comments/");
    expect(script).toContain('mode === "readiness"');
    expect(script).toContain('mode === "autonomous-running"');
    expect(script).toContain('mode === "autonomous-result"');
    expect(script).toContain('mode === "autonomous-failure"');

    await expect(
      execFileAsync(process.execPath, [
        "--check",
        ".github/scripts/update-dna-runtime-status.mjs",
      ]),
    ).resolves.toBeDefined();
  });
});
