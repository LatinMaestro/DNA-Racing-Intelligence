import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportProgressPanel } from "../components/import-progress-panel";
import type { ImportProgressBatch } from "../domain/import-progress";

const readyBatch: ImportProgressBatch = {
  batchId: "synthetic-batch-1",
  sourceType: "race_merge",
  status: "accepted",
  importCompletedAt: "2026-07-26T01:10:00.000Z",
  dataCurrentThrough: "2026-07-25T23:00:00.000Z",
  aggregateRefreshedAt: "2026-07-26T01:15:00.000Z",
  sourceRows: 12,
  acceptedRows: 12,
  rejectedRows: 0,
  warningRows: 0,
  isActive: true,
  priorVersionAvailable: true,
  identityReviewCount: 0,
  reconciliationReviewCount: 0,
};

describe("import progress panel", () => {
  it("renders an accessible historical completion summary with disabled actions", () => {
    const markup = renderToStaticMarkup(
      <ImportProgressPanel
        batches={[readyBatch]}
        rollbackActionStatus="ready"
      />,
    );

    expect(markup).toContain("Update progress &amp; completion");
    expect(markup).toContain("Historical views ready");
    expect(markup).toContain("Data current through");
    expect(markup).toContain("Rollback connected");
    expect(markup).toContain("Restore prior accepted dataset");
    expect(markup).toContain("Rollback reason");
    expect(markup).toContain("Restore the prior accepted version");
    expect(markup).toContain("disabled");
    expect(markup).not.toMatch(/\blive\b/i);
    expect(markup).toContain('name="batchId" value="synthetic-batch-1"');
  });

  it("renders a fail-closed empty state", () => {
    const markup = renderToStaticMarkup(
      <ImportProgressPanel
        batches={[]}
        rollbackActionStatus="not_configured"
      />,
    );

    expect(markup).toContain("No private update progress is available");
    expect(markup).toContain(
      "Provider-backed actions are shown only when an eligible accepted dataset",
    );
  });

  it("keeps rollback disabled when owner-scoped persistence is not configured", () => {
    const markup = renderToStaticMarkup(
      <ImportProgressPanel
        batches={[readyBatch]}
        rollbackActionStatus="not_configured"
      />,
    );

    expect(markup).toContain("Recovery actions unavailable");
    expect(markup).toContain("Rollback unavailable");
    expect(markup).not.toContain("Rollback reason");
  });
});
