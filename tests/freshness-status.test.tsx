import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FreshnessStatus } from "@/components/freshness-status";
import type { SourceImportStatus } from "@/domain/import-workflow";

const raceStatus: SourceImportStatus = {
  sourceType: "race_merge",
  latestBatchStatus: "accepted",
  latestBatchUploadedAt: "2026-10-13T04:00:00.000Z",
  activeBatchId: "synthetic-race-receipt",
  dataCurrentThrough: "2026-10-12T04:00:00.000Z",
  lastImportedAt: "2026-10-13T04:05:00.000Z",
  aggregateRefreshedAt: "2026-10-13T04:06:00.000Z",
  freshness: "current",
  acceptedRows: 2,
  rejectedRows: 0,
  warningRows: 0,
};

describe("dashboard freshness status", () => {
  it("shows an accepted source receipt without describing it as live", () => {
    const markup = renderToStaticMarkup(
      <FreshnessStatus
        connectionStatus="read_model_connected"
        source="Race"
        status={raceStatus}
      />,
    );

    expect(markup).toContain("Owner-scoped accepted source receipt connected");
    expect(markup).toContain("Freshness current");
    expect(markup).toContain("2026-10-12 04:00:00 UTC");
    expect(markup).toContain("2026-10-13 04:05:00 UTC");
    expect(markup).toContain("Latest update");
    expect(markup).toContain("accepted");
    expect(markup).not.toContain("live data");
  });

  it("keeps the last accepted snapshot visible when a later update is quarantined", () => {
    const markup = renderToStaticMarkup(
      <FreshnessStatus
        connectionStatus="read_model_connected"
        source="Race"
        status={{ ...raceStatus, latestBatchStatus: "quarantined" }}
      />,
    );

    expect(markup).toContain("Serving the last accepted snapshot");
    expect(markup).toContain("latest update is quarantined");
    expect(markup).toContain("2026-10-12 04:00:00 UTC");
  });

  it("does not expose supplied receipt values after an optional read failure", () => {
    const markup = renderToStaticMarkup(
      <FreshnessStatus
        connectionStatus="read_failed"
        source="Race"
        status={raceStatus}
      />,
    );

    expect(markup).toContain(
      "Private source receipt status is temporarily unavailable",
    );
    expect(markup).toContain("Freshness unknown here");
    expect(markup).not.toContain("2026-10-12");
    expect(markup).not.toContain("synthetic-race-receipt");
  });

  it("rejects a source receipt wired to the wrong Dashboard card", () => {
    expect(() =>
      renderToStaticMarkup(
        <FreshnessStatus
          connectionStatus="read_model_connected"
          source="Core"
          status={raceStatus}
        />,
      ),
    ).toThrow("source does not match");
  });
});
