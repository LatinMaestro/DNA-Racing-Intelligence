import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/open-race-preview-migrations.yml";

describe("Open Race Preview migration workflow", () => {
  it("checks the PUBLIC execute grant through function ACLs", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("pg_catalog.aclexplode");
    expect(workflow).toContain("acl.grantee = 0");
    expect(workflow).toContain("acl.privilege_type = 'EXECUTE'");
    expect(workflow).not.toContain(
      "has_function_privilege('PUBLIC', function_name, 'EXECUTE')",
    );
  });
});
