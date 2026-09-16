import { describe, expect, it } from "vitest";

import { adaptDnaCoreRaceHistoryResult } from "@/lib/dna-core-race-history-adapter";
import {
  DnaCoreRaceHistoryMaterializationError,
  materializeDnaCoreRaceHistory,
  type DnaCoreRaceHistoryMaterializationCycle,
  type DnaCoreRaceHistoryMaterializationPage,
} from "@/lib/dna-core-race-history-materialization";
import type { DnaCoreRaceHistoryRow } from "@/lib/dna-core-race-history-client";
import {
  adaptDnaRaceDocument,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";
import type { DnaRaceDocument } from "@/lib/dna-open-lab-v1-client";

const ownerId = "private-owner";
const cycleOne = "a".repeat(64);
const cycleTwo = "b".repeat(64);
const observedAt = "2026-09-15T06:00:00.000Z";
const materializedAt = "2026-09-15T07:00:00.000Z";

function result(overrides: Readonly<Record<string, unknown>> = {}) {
  const raw: DnaCoreRaceHistoryRow = {
    hid: 42,
    rid: "race-1",
    rvmode: "bike",
    cb: 12,
    time: 65.125,
    pos: 1,
    start_time: "2026-09-14T10:20:30Z",
    format: "normal",
    ...overrides,
  };
  const adapted = adaptDnaCoreRaceHistoryResult({
    requestedCoreId: Number(raw.hid),
    raw,
    observedAt,
  });
  if (adapted.status !== "ready") throw new Error("synthetic result rejected");
  return adapted.evidence;
}

function document(
  overrides: Readonly<Record<string, unknown>> = {},
): DnaOpenLabEvidence<CanonicalRaceDocumentMetadata> {
  const raw = Object.fromEntries(
    Object.entries({
      rid: "race-1",
      status: "finished",
      rvmode: "bike",
      cb: 12,
      rgate: 2,
      hs_in: 2,
      hids: [42, 84],
      payout: "Winner Take All",
      start_time: "2026-09-14T10:20:30Z",
      yellowstars: [42],
      bluestars: [84],
      ...overrides,
    }).filter(([, value]) => value !== undefined),
  ) as DnaRaceDocument;
  return adaptDnaRaceDocument({ raw, observedAt, endpoint: "races.docs" });
}

function page(
  input: {
    cycleId?: string;
    pageNumber?: number;
    owner?: string;
    evidence?: ReturnType<typeof result>;
    terminal?: boolean;
  } = {},
): DnaCoreRaceHistoryMaterializationPage {
  const terminal = input.terminal ?? false;
  const results = terminal
    ? Object.freeze([])
    : Object.freeze([input.evidence ?? result()]);
  return Object.freeze({
    ownerId: input.owner ?? ownerId,
    cycleId: input.cycleId ?? cycleOne,
    attemptNumber: 1,
    coreId: 42,
    pageNumber: input.pageNumber ?? 1,
    sourceRowCount: results.length,
    terminal,
    results,
  });
}

function cycle(
  cycleId: string = cycleOne,
): DnaCoreRaceHistoryMaterializationCycle {
  return Object.freeze({
    ownerId,
    cycleId,
    attemptNumber: 1,
    status: "complete",
    evaluatedAt: "2026-09-15T05:00:00.000Z",
    completedAt: "2026-09-15T06:30:00.000Z",
    coreIds: Object.freeze(["42"]),
  });
}

function completePages(
  resultPage: DnaCoreRaceHistoryMaterializationPage = page(),
): readonly DnaCoreRaceHistoryMaterializationPage[] {
  return Object.freeze([
    resultPage,
    page({
      cycleId: resultPage.cycleId,
      pageNumber: resultPage.pageNumber + 1,
      terminal: true,
    }),
  ]);
}

function materialize(
  input: {
    cycles?: readonly DnaCoreRaceHistoryMaterializationCycle[];
    pages?: readonly DnaCoreRaceHistoryMaterializationPage[];
    documents?: readonly DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>[];
  } = {},
) {
  return materializeDnaCoreRaceHistory({
    ownerId,
    cycles: input.cycles ?? [cycle()],
    pages: input.pages ?? completePages(),
    raceDocuments: input.documents ?? [document()],
    materializedAt,
    maximumPages: 100,
    maximumResults: 1_000,
    maximumRaceDocuments: 1_000,
  });
}

function expectDiagnostic(
  operation: () => unknown,
  diagnostic: DnaCoreRaceHistoryMaterializationError["diagnostic"],
) {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DnaCoreRaceHistoryMaterializationError);
  expect(caught).toMatchObject({
    diagnostic,
    message: "DNA Core race history materialization is unavailable",
  });
  expect(String(caught)).not.toContain("race-1");
}

describe("DNA Core race history materialization", () => {
  it("deduplicates exact cross-page and cross-cycle replay before joining complete race authority", () => {
    const evidence = result();
    const value = materialize({
      cycles: [cycle(cycleOne), cycle(cycleTwo)],
      pages: [
        page({ evidence }),
        page({ cycleId: cycleOne, pageNumber: 2, evidence }),
        page({ cycleId: cycleOne, pageNumber: 3, terminal: true }),
        page({ cycleId: cycleTwo, evidence }),
        page({ cycleId: cycleTwo, pageNumber: 2, terminal: true }),
      ],
      documents: [document(), document()],
    });

    expect(value).toMatchObject({
      ownerId,
      inputCycleCount: 2,
      inputPageCount: 5,
      inputResultCount: 3,
      replayDuplicateCount: 2,
      raceDocumentCount: 1,
      entrantAuthorityOmissionCount: 0,
      exactDistanceConfirmedCount: 1,
      acceptedPublishedCellCount: 1,
      missingFormatCount: 0,
      unsupportedFormatCount: 0,
      unpublishedCellCount: 0,
    });
    expect(value.observations).toEqual([
      expect.objectContaining({
        naturalKey: "core-result:42:bike:race-1",
        sourceCoreId: "42",
        sourceRaceId: "race-1",
        mode: "bike",
        distanceMetres: 1200,
        distanceAuthority: "result_and_race_document",
        elapsedMilliseconds: 65_125,
        finishPosition: 1,
        gateCount: 2,
        eventAt: "2026-09-14T10:20:30.000Z",
        goldStar: true,
        blueStar: false,
        starEvidenceStatus: "available",
        publishedCellStatus: "accepted",
        raceType: "1v1",
      }),
    ]);
  });

  it("rejects a page from another owner before exposing evidence", () => {
    expectDiagnostic(
      () =>
        materialize({
          pages: completePages(page({ owner: "another-owner" })),
        }),
      "invalid_page_evidence",
    );
  });

  it("holds a changed result under one stable identity", () => {
    expectDiagnostic(
      () =>
        materialize({
          cycles: [cycle(cycleOne), cycle(cycleTwo)],
          pages: [
            page(),
            page({ cycleId: cycleOne, pageNumber: 2, terminal: true }),
            page({ cycleId: cycleTwo, evidence: result({ time: 66.25 }) }),
            page({ cycleId: cycleTwo, pageNumber: 2, terminal: true }),
          ],
        }),
      "result_replay_conflict",
    );
  });

  it("holds a changed race document under one stable identity", () => {
    expectDiagnostic(
      () =>
        materialize({
          documents: [document(), document({ payout: "Top 3" })],
        }),
      "race_document_replay_conflict",
    );
  });

  it("requires every result to join to exactly one race document", () => {
    expectDiagnostic(
      () => materialize({ documents: [] }),
      "race_document_missing",
    );
    expectDiagnostic(
      () => materialize({ documents: [document({ hids: [84] })] }),
      "race_document_entrant_mismatch",
    );
  });

  it("omits only results whose race document explicitly quarantines entrant authority", () => {
    const value = materialize({ documents: [document({ hids: null })] });

    expect(value).toMatchObject({
      inputResultCount: 1,
      replayDuplicateCount: 0,
      entrantAuthorityOmissionCount: 1,
      exactDistanceConfirmedCount: 0,
      acceptedPublishedCellCount: 0,
      missingFormatCount: 0,
      unsupportedFormatCount: 0,
      unpublishedCellCount: 0,
    });
    expect(value.observations).toEqual([]);

    expectDiagnostic(
      () => materialize({ documents: [document({ hids: undefined })] }),
      "race_document_entrant_authority_unavailable",
    );
  });

  it("rejects a race document outside the exact requested result set", () => {
    expectDiagnostic(
      () =>
        materialize({
          documents: [document(), document({ rid: "race-2" })],
        }),
      "race_document_unexpected",
    );
  });

  it("rejects a missing terminal page before joining partial history", () => {
    expectDiagnostic(
      () => materialize({ pages: [page()] }),
      "incomplete_cycle_evidence",
    );
  });

  it.each([
    ["race_document_mode_unavailable", { rvmode: undefined }],
    ["race_document_mode_mismatch", { rvmode: "car" }],
    ["race_document_distance_unavailable", { cb: null }],
    ["race_document_distance_mismatch", { cb: 14 }],
    ["race_document_gate_count_unavailable", { rgate: undefined }],
    ["finish_position_exceeds_gate_count", { rgate: 1 }],
    ["event_time_mismatch", { start_time: "2026-09-14T10:20:31Z" }],
  ] as const)("fails closed for %s", (diagnostic, overrides) => {
    const pages =
      diagnostic === "finish_position_exceeds_gate_count"
        ? { pages: completePages(page({ evidence: result({ pos: 2 }) })) }
        : {};
    expectDiagnostic(
      () =>
        materialize({
          ...pages,
          documents: [document(overrides)],
        }),
      diagnostic,
    );
  });

  it("retains unsupported exact-format evidence as an explicit non-published status", () => {
    const value = materialize({
      documents: [document({ payout: "Double Up" })],
    });

    expect(value).toMatchObject({
      acceptedPublishedCellCount: 0,
      unsupportedFormatCount: 1,
    });
    expect(value.observations[0]).toMatchObject({
      publishedCellStatus: "unsupported_format",
      raceType: null,
      mapIds: [],
    });
  });
});
