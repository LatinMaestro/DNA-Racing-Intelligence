import { describe, expect, it } from "vitest";

import {
  acceptDnaCurrentStateCandidate,
  beginDnaCurrentStateCatchUp,
  createInitialDnaLastGoodSyncState,
  inspectDnaCurrentStateCandidate,
  pauseDnaCurrentStateSync,
  type DnaCurrentStateCandidate,
  type DnaCurrentStateFamily,
  type DnaCurrentStateFamilyStatus,
} from "../lib/dna-open-lab-last-good-publication";

function candidate(input?: {
  generationId?: string;
  observedAt?: string;
  partialFamily?: DnaCurrentStateFamily;
}): DnaCurrentStateCandidate {
  const complete = (itemCount: number): DnaCurrentStateFamilyStatus => ({
    status: "complete",
    itemCount,
  });
  const families: Record<DnaCurrentStateFamily, DnaCurrentStateFamilyStatus> = {
    vault: complete(1),
    cores: complete(24),
    active_races: complete(6),
    race_fills: complete(6),
    tokens: complete(1),
    splice_arena: complete(18),
  };
  if (input?.partialFamily !== undefined) {
    families[input.partialFamily] = { status: "partial", itemCount: 1 };
  }
  return {
    generationId: input?.generationId ?? "generation-1",
    observedAt: input?.observedAt ?? "2026-08-27T09:00:00Z",
    families,
  };
}

describe("DNA Open Lab last-good publication", () => {
  it("accepts only a complete candidate and moves the serving pointer atomically", () => {
    const initial = createInitialDnaLastGoodSyncState();
    const accepted = acceptDnaCurrentStateCandidate({
      previous: initial,
      candidate: candidate(),
      acceptedAt: "2026-08-27T09:01:00Z",
    });

    expect(accepted).toMatchObject({
      acceptedGenerationId: "generation-1",
      acceptedObservedAt: "2026-08-27T09:00:00.000Z",
      acceptedAt: "2026-08-27T09:01:00.000Z",
      servingGenerationId: "generation-1",
      syncStatus: "current",
      catchUpRequired: false,
      lastInterruption: null,
    });
  });

  it("refuses to publish a partial refresh", () => {
    const partial = candidate({ partialFamily: "cores" });

    expect(inspectDnaCurrentStateCandidate(partial)).toEqual({
      ready: false,
      incompleteFamilies: ["cores"],
    });
    expect(() =>
      acceptDnaCurrentStateCandidate({
        previous: createInitialDnaLastGoodSyncState(),
        candidate: partial,
        acceptedAt: "2026-08-27T09:01:00Z",
      }),
    ).toThrow("candidate is incomplete: cores");
  });

  it("preserves the last-good serving generation through rate loss and catch-up", () => {
    const accepted = acceptDnaCurrentStateCandidate({
      previous: createInitialDnaLastGoodSyncState(),
      candidate: candidate(),
      acceptedAt: "2026-08-27T09:01:00Z",
    });
    const paused = pauseDnaCurrentStateSync({
      previous: accepted,
      reason: "rate_limited",
      attemptedAt: "2026-08-27T09:10:00Z",
      retryAfterSeconds: 30,
    });

    expect(paused).toMatchObject({
      acceptedGenerationId: "generation-1",
      servingGenerationId: "generation-1",
      syncStatus: "paused",
      catchUpRequired: true,
      lastInterruption: {
        reason: "rate_limited",
        at: "2026-08-27T09:10:00.000Z",
        retryAfterSeconds: 30,
      },
    });

    const catchingUp = beginDnaCurrentStateCatchUp({
      previous: paused,
      attemptedAt: "2026-08-27T09:11:00Z",
    });
    expect(catchingUp.servingGenerationId).toBe("generation-1");
    expect(catchingUp.syncStatus).toBe("catching_up");

    const recovered = acceptDnaCurrentStateCandidate({
      previous: catchingUp,
      candidate: candidate({
        generationId: "generation-2",
        observedAt: "2026-08-27T09:12:00Z",
      }),
      acceptedAt: "2026-08-27T09:13:00Z",
    });
    expect(recovered).toMatchObject({
      acceptedGenerationId: "generation-2",
      servingGenerationId: "generation-2",
      syncStatus: "current",
      catchUpRequired: false,
      lastCatchUpCompletedAt: "2026-08-27T09:13:00.000Z",
      lastInterruption: null,
    });
  });

  it("preserves last-good data for API eligibility and availability interruptions", () => {
    const accepted = acceptDnaCurrentStateCandidate({
      previous: createInitialDnaLastGoodSyncState(),
      candidate: candidate(),
      acceptedAt: "2026-08-27T09:01:00Z",
    });

    for (const reason of ["api_ineligible", "api_unavailable"] as const) {
      const paused = pauseDnaCurrentStateSync({
        previous: accepted,
        reason,
        attemptedAt: "2026-08-27T09:20:00Z",
      });
      expect(paused.acceptedGenerationId).toBe("generation-1");
      expect(paused.servingGenerationId).toBe("generation-1");
      expect(paused.catchUpRequired).toBe(true);
    }
  });

  it("rejects chronological regression behind the accepted dataset", () => {
    const accepted = acceptDnaCurrentStateCandidate({
      previous: createInitialDnaLastGoodSyncState(),
      candidate: candidate({ observedAt: "2026-08-27T09:12:00Z" }),
      acceptedAt: "2026-08-27T09:13:00Z",
    });

    expect(() =>
      acceptDnaCurrentStateCandidate({
        previous: accepted,
        candidate: candidate({
          generationId: "generation-old",
          observedAt: "2026-08-27T09:11:59Z",
        }),
        acceptedAt: "2026-08-27T09:14:00Z",
      }),
    ).toThrow("candidate observedAt cannot regress behind last-good");
  });

  it("allows idempotent replay of the same complete generation", () => {
    const first = acceptDnaCurrentStateCandidate({
      previous: createInitialDnaLastGoodSyncState(),
      candidate: candidate(),
      acceptedAt: "2026-08-27T09:01:00Z",
    });
    const replay = acceptDnaCurrentStateCandidate({
      previous: first,
      candidate: candidate(),
      acceptedAt: "2026-08-27T09:02:00Z",
    });

    expect(replay.acceptedGenerationId).toBe("generation-1");
    expect(replay.servingGenerationId).toBe("generation-1");
    expect(replay.syncStatus).toBe("current");
  });

  it("fails closed on invalid timestamps, counts and catch-up transitions", () => {
    const base = candidate();
    const invalidCount: DnaCurrentStateCandidate = {
      ...base,
      families: {
        ...base.families,
        cores: { status: "complete", itemCount: -1 },
      },
    };

    expect(() => inspectDnaCurrentStateCandidate(invalidCount)).toThrow(
      "cores.itemCount must be a non-negative safe integer",
    );
    expect(() =>
      pauseDnaCurrentStateSync({
        previous: createInitialDnaLastGoodSyncState(),
        reason: "rate_limited",
        attemptedAt: "not-a-time",
      }),
    ).toThrow("attemptedAt must be a timezone-qualified ISO timestamp");
    expect(() =>
      beginDnaCurrentStateCatchUp({
        previous: createInitialDnaLastGoodSyncState(),
        attemptedAt: "2026-08-27T09:00:00Z",
      }),
    ).toThrow("catch-up cannot begin when no catch-up is required");
  });
});
