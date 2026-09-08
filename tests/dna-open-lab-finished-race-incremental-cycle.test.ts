import { describe, expect, it } from "vitest";

import type { DnaFinishedRaceBackfillCheckpoint } from "@/lib/dna-open-lab-finished-race-backfill";
import {
  assertDnaFinishedRaceIncrementalCycleTransition,
  beginReplacementDnaFinishedRaceIncrementalCycleAttempt,
  completeDnaFinishedRaceIncrementalCycle,
  createDnaFinishedRaceIncrementalCycle,
  dnaFinishedRaceIncrementalAttemptId,
  dnaFinishedRaceIncrementalCycleId,
  pauseDnaFinishedRaceIncrementalCycle,
  resumeDnaFinishedRaceIncrementalCycle,
  supersedeDnaFinishedRaceIncrementalCycle,
  validateDnaFinishedRaceIncrementalCycle,
} from "@/lib/dna-open-lab-finished-race-incremental-cycle";

const lowerBoundAt = "2026-09-02T00:11:55.961Z";
const upperBoundAt = "2026-09-03T00:11:55.961Z";

function checkpoint(
  overrides: Partial<DnaFinishedRaceBackfillCheckpoint> = {},
): DnaFinishedRaceBackfillCheckpoint {
  const rootWindow = Object.freeze({
    startTime: lowerBoundAt,
    endTime: upperBoundAt,
  });
  return Object.freeze({
    version: 1 as const,
    rootWindow,
    pendingWindows: Object.freeze([rootWindow]),
    minimumWindowMilliseconds: 1,
    completedWindowCount: 0,
    splitCount: 0,
    successfulFinishedRaceRequestCount: 0,
    raceDocumentRequestCount: 0,
    publishedWindowDocumentCount: 0,
    identityOmissionAuthority: null,
    omittedIdentityObservationCount: 0,
    ...overrides,
  });
}

function cycle(checkpointOverride = checkpoint()) {
  return createDnaFinishedRaceIncrementalCycle({
    lowerBoundAt,
    upperBoundAt,
    previousCompletedCycleId: null,
    checkpoint: checkpointOverride,
  });
}

describe("DNA Open Lab finished-race incremental cycle", () => {
  it("derives stable cycle and attempt identities from immutable authority", () => {
    const expectedCycleId = dnaFinishedRaceIncrementalCycleId({
      lowerBoundAt,
      upperBoundAt,
      previousCompletedCycleId: null,
    });
    const first = cycle();
    const replay = cycle();

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      cycleId: expectedCycleId,
      attemptId: dnaFinishedRaceIncrementalAttemptId({
        cycleId: expectedCycleId,
        attemptNumber: 1,
      }),
      attemptNumber: 1,
      status: "running",
      sourceFamily: "races_finished",
    });
  });

  it("rejects bounds drift and historical omission authority", () => {
    const valid = cycle();
    expect(() =>
      validateDnaFinishedRaceIncrementalCycle({
        ...valid,
        upperBoundAt: "2026-09-04T00:11:55.961Z",
      }),
    ).toThrow("identity does not match its bounds");

    expect(() =>
      createDnaFinishedRaceIncrementalCycle({
        lowerBoundAt,
        upperBoundAt,
        previousCompletedCycleId: null,
        checkpoint: checkpoint({
          identityOmissionAuthority: {
            measurementEvidenceSha256: "a".repeat(64),
            maximumObservationCount: 1,
          },
        }),
      }),
    ).toThrow("historical omission authority cannot carry");

    expect(() =>
      createDnaFinishedRaceIncrementalCycle({
        lowerBoundAt,
        upperBoundAt,
        previousCompletedCycleId: null,
        checkpoint: checkpoint({ completedWindowCount: 1 }),
      }),
    ).toThrow("must begin at its unprocessed root window");

    expect(() =>
      dnaFinishedRaceIncrementalCycleId({
        lowerBoundAt: "2026-09-02T00:11:55.960Z",
        upperBoundAt,
        previousCompletedCycleId: null,
      }),
    ).toThrow("must begin at the immutable P5 cutoff");
  });

  it("pauses and resumes without changing durable progress", () => {
    const running = cycle();
    const paused = pauseDnaFinishedRaceIncrementalCycle({
      cycle: running,
      reason: "rate_limited",
      pausedAt: "2026-09-03T00:12:00Z",
      retryAt: "2026-09-03T00:13:00Z",
    });
    const resumed = resumeDnaFinishedRaceIncrementalCycle(paused);

    expect(paused).toMatchObject({
      status: "paused",
      pause: { reason: "rate_limited" },
      checkpoint: running.checkpoint,
    });
    expect(resumed).toMatchObject({ status: "running", pause: null });
    expect(resumed.checkpoint).toEqual(running.checkpoint);
  });

  it("allows monotonic progress and rejects regressed counters", () => {
    const running = cycle();
    const progressed = validateDnaFinishedRaceIncrementalCycle({
      ...running,
      checkpoint: checkpoint({
        successfulFinishedRaceRequestCount: 1,
        splitCount: 1,
      }),
    });

    expect(() =>
      assertDnaFinishedRaceIncrementalCycleTransition(running, progressed),
    ).not.toThrow();
    expect(() =>
      assertDnaFinishedRaceIncrementalCycleTransition(progressed, running),
    ).toThrow("progress regressed");
  });

  it("binds completion to an empty checkpoint and rejects later mutation", () => {
    const running = cycle();
    const finalCheckpoint = checkpoint({
      pendingWindows: Object.freeze([]),
      completedWindowCount: 1,
      successfulFinishedRaceRequestCount: 1,
      raceDocumentRequestCount: 1,
      publishedWindowDocumentCount: 7,
    });
    const complete = completeDnaFinishedRaceIncrementalCycle({
      cycle: running,
      checkpoint: finalCheckpoint,
      completedAt: "2026-09-03T00:15:00Z",
    });

    expect(complete.status).toBe("complete");
    expect(complete.completion).toMatchObject({
      checkpointSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      completionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(() =>
      assertDnaFinishedRaceIncrementalCycleTransition(complete, {
        ...complete,
        status: "running",
        completion: null,
      }),
    ).toThrow("terminal incremental attempt cannot change");

    expect(() =>
      completeDnaFinishedRaceIncrementalCycle({
        cycle: running,
        checkpoint: finalCheckpoint,
        completedAt: "2026-09-02T23:59:59Z",
      }),
    ).toThrow("cannot precede its upper bound");
  });

  it("supersedes an attempt and starts one bounded replacement", () => {
    const paused = pauseDnaFinishedRaceIncrementalCycle({
      cycle: cycle(),
      reason: "operator_hold",
      pausedAt: "2026-09-03T00:12:00Z",
    });
    const superseded = supersedeDnaFinishedRaceIncrementalCycle(paused);
    const replacement =
      beginReplacementDnaFinishedRaceIncrementalCycleAttempt(superseded);

    expect(superseded).toMatchObject({
      status: "superseded",
      supersededByAttemptNumber: 2,
    });
    expect(replacement).toMatchObject({
      cycleId: superseded.cycleId,
      attemptNumber: 2,
      status: "running",
      checkpoint: superseded.checkpoint,
    });
    expect(replacement.attemptId).not.toBe(superseded.attemptId);
  });
});
