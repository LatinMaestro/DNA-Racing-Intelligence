import { describe, expect, it } from "vitest";

import {
  adaptDnaCoreRaceHistoryPage,
  adaptDnaCoreRaceHistoryResult,
  type DnaCoreRaceHistoryDiagnostic,
} from "../lib/dna-core-race-history-adapter";
import type { DnaCoreRaceHistoryRow } from "../lib/dna-core-race-history-client";

const observedAt = "2026-09-15T04:00:00.000Z";

function row(
  overrides: Readonly<Record<string, unknown>> = {},
): DnaCoreRaceHistoryRow {
  return {
    hid: 42,
    rid: "race-1",
    rvmode: "bike",
    cb: 12,
    time: 65.125,
    pos: 2,
    rgate: 8,
    start_time: "2026-09-14T10:20:30Z",
    format: "normal",
    track: "synthetic-track",
    ...overrides,
  };
}

function expectDiagnostic(
  raw: DnaCoreRaceHistoryRow,
  diagnostic: DnaCoreRaceHistoryDiagnostic,
) {
  const result = adaptDnaCoreRaceHistoryResult({
    requestedCoreId: 42,
    raw,
    observedAt,
  });
  expect(result).toMatchObject({
    status: "quarantined",
    diagnostic,
    rawEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
}

describe("DNA Core race history adapter", () => {
  it("canonicalizes linked result identity, distance, elapsed time and finish position", () => {
    const result = adaptDnaCoreRaceHistoryResult({
      requestedCoreId: 42,
      raw: row(),
      observedAt,
    });

    expect(result).toEqual({
      status: "ready",
      evidence: {
        source: "dna_open_lab",
        sourceVersion: "core-history-v1",
        scope: "races",
        endpoint: "core.history",
        entityKey: "core-result:42:bike:race-1",
        observedAt,
        rawEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        canonical: {
          sourceType: "core_race_history_result",
          sourceCoreId: "42",
          sourceRaceId: "race-1",
          mode: "bike",
          distance: 1200,
          elapsedTimeSourceValue: "65.125",
          finishPosition: 2,
          eventAt: "2026-09-14T10:20:30.000Z",
          sourceFormat: "normal",
          trackSourceValue: "synthetic-track",
        },
      },
    });
  });

  it("preserves already-normalized metre values and optional unknowns", () => {
    const result = adaptDnaCoreRaceHistoryResult({
      requestedCoreId: 42,
      raw: row({
        cb: 1200,
        start_time: null,
        format: undefined,
        track: undefined,
      }),
      observedAt,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(result.evidence.canonical).toMatchObject({
      distance: 1200,
      eventAt: null,
      sourceFormat: null,
      trackSourceValue: null,
    });
  });

  it("quarantines missing or invalid analytical fields and cross-Core rows", () => {
    expectDiagnostic(row({ hid: 43 }), "core_history_owner_core_mismatch");
    expectDiagnostic(
      row({ rid: "" }),
      "core_history_race_identity_unavailable",
    );
    expectDiagnostic(
      row({ rvmode: "hovercraft" }),
      "core_history_mode_unavailable",
    );
    expectDiagnostic(row({ cb: 0 }), "core_history_distance_unavailable");
    expectDiagnostic(
      row({ time: null }),
      "core_history_elapsed_time_unavailable",
    );
    expectDiagnostic(
      row({ pos: 1.5 }),
      "core_history_finish_position_unavailable",
    );
  });

  it("deduplicates exact replays and holds conflicting duplicate identities", () => {
    const replay = adaptDnaCoreRaceHistoryPage({
      requestedCoreId: 42,
      rows: [row(), row()],
      observedAt,
    });
    expect(replay).toMatchObject({
      status: "ready",
      replayDuplicateCount: 1,
      conflictCount: 0,
    });
    expect(replay.accepted).toHaveLength(1);

    const conflict = adaptDnaCoreRaceHistoryPage({
      requestedCoreId: 42,
      rows: [row(), row({ time: 66.25 })],
      observedAt,
    });
    expect(conflict).toMatchObject({
      status: "held_conflict",
      replayDuplicateCount: 0,
      conflictCount: 1,
    });
    expect(conflict.accepted).toHaveLength(1);
  });

  it("retains bounded quarantine evidence without exposing source values in diagnostics", () => {
    const adapted = adaptDnaCoreRaceHistoryPage({
      requestedCoreId: 42,
      rows: [row(), row({ rid: "private-race", pos: null })],
      observedAt,
    });

    expect(adapted.status).toBe("ready");
    expect(adapted.accepted).toHaveLength(1);
    expect(adapted.quarantined).toEqual([
      {
        rowIndex: 1,
        diagnostic: "core_history_finish_position_unavailable",
        rawEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    ]);
    expect(JSON.stringify(adapted.quarantined)).not.toContain("private-race");
  });
});
