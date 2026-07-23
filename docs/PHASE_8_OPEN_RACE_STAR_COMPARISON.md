# Phase 8 Open Race Star Comparison

## Purpose

Compare the revealed post-lock stars with the frozen pre-entry ranking and the
owned core actually committed.

## Contract

- Preserve the chronological ranking, lock, observation and comparison order.
- Preserve the original ranked candidate order and provisional leader.
- Report Gold, Blue, both, neither or incomplete observation for the committed
  core and provisional leader.
- Report a provisional leader that was not entered separately from an entered
  core that received neither star.
- Support a user-selected alternative and a ranking with no resolved leader.
- Hold incomplete, anomalous or review-required observations for review.
- Keep Gold unavailable at three gates or fewer.

## Boundaries

The comparison is diagnostic only. It cannot rerank candidates, make a
replacement recommendation, claim that a prediction succeeded or treat the
pre-run stars as a completed race outcome.
