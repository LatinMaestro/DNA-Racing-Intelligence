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
      <ImportProgressPanel batches={[readyBatch]} />,
    );

    expect(markup).toContain("Update progress &amp; completion");
    expect(markup).toContain("Historical views ready");
    expect(markup).toContain("Data current through");
    expect(markup).toContain("Provider actions unavailable");
    expect(markup).toContain("disabled");
    expect(markup).not.toMatch(/\blive\b/i);
    expect(markup).not.toContain("synthetic-batch-1");
  });

  it("renders a fail-closed empty state", () => {
    const markup = renderToStaticMarkup(<ImportProgressPanel batches={[]} />);

    expect(markup).toContain("No private update progress is available");
    expect(markup).toContain(
      "Upload, confirmation, aggregate retry and rollback remain disabled",
    );
  });
});
