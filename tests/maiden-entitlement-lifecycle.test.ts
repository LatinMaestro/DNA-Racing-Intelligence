import { describe, expect, it } from "vitest";

import {
  buildMaidenEntitlementLifecycle,
  type MaidenEntitlementLifecycleInput,
} from "@/domain/maiden-entitlement-lifecycle";

function input(
  overrides: Partial<MaidenEntitlementLifecycleInput> = {},
): MaidenEntitlementLifecycleInput {
  return {
    coreId: "core-me",
    snapshotState: "eligible",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    events: [],
    ...overrides,
  };
}

describe("Maiden entitlement lifecycle", () => {
  it("preserves an eligible imported entitlement without inventing a plan", () => {
    const result = buildMaidenEntitlementLifecycle(input());
    expect(result).toEqual(
      expect.objectContaining({
        currentState: "eligible",
        tournamentId: null,
        currentRevision: 0,
        actionableRecommendationAllowed: false,
      }),
    );
  });

  it("records plan, commitment and consumption as sequential audited events", () => {
    const result = buildMaidenEntitlementLifecycle(
      input({
        events: [
          {
            eventId: "event-1",
            revision: 1,
            action: "plan",
            tournamentId: "car-maiden",
            reason: "Provisional strongest-mode review",
            occurredAt: "2026-07-21T01:00:00Z",
          },
          {
            eventId: "event-2",
            revision: 2,
            action: "commit",
            tournamentId: "car-maiden",
            reason: "Owner confirmed entry",
            occurredAt: "2026-07-21T02:00:00Z",
          },
          {
            eventId: "event-3",
            revision: 3,
            action: "consume",
            tournamentId: "car-maiden",
            reason: "Maiden entry recorded",
            occurredAt: "2026-07-21T03:00:00Z",
          },
        ],
      }),
    );

    expect(result.currentState).toBe("consumed");
    expect(result.tournamentId).toBe("car-maiden");
    expect(result.history.map(({ stateAfter }) => stateAfter)).toEqual([
      "planned",
      "committed",
      "consumed",
    ]);
    expect(result.warnings).toContain("ENTITLEMENT_CONSUMED");
  });

  it("allows a plan or commitment to be released recoverably", () => {
    const result = buildMaidenEntitlementLifecycle(
      input({
        events: [
          {
            eventId: "event-1",
            revision: 1,
            action: "plan",
            tournamentId: "horse-maiden",
            reason: "Review candidate",
            occurredAt: "2026-07-21T01:00:00Z",
          },
          {
            eventId: "event-2",
            revision: 2,
            action: "commit",
            tournamentId: "horse-maiden",
            reason: "Temporary commitment",
            occurredAt: "2026-07-21T02:00:00Z",
          },
          {
            eventId: "event-3",
            revision: 3,
            action: "release_commitment",
            tournamentId: "horse-maiden",
            reason: "Preserve for stronger Car mode",
            occurredAt: "2026-07-21T03:00:00Z",
          },
        ],
      }),
    );

    expect(result.currentState).toBe("eligible");
    expect(result.tournamentId).toBeNull();
    expect(result.history[2]).toEqual(
      expect.objectContaining({
        stateBefore: "committed",
        stateAfter: "eligible",
      }),
    );
  });

  it("does not plan from unresolved, invalid or ineligible snapshot evidence", () => {
    for (const snapshotState of [
      "unknown",
      "invalid",
      "not_eligible",
    ] as const) {
      expect(() =>
        buildMaidenEntitlementLifecycle(
          input({
            snapshotState,
            events: [
              {
                eventId: "event-1",
                revision: 1,
                action: "plan",
                tournamentId: "bike-maiden",
                reason: "Invalid plan",
                occurredAt: "2026-07-21T01:00:00Z",
              },
            ],
          }),
        ),
      ).toThrow("Planning requires an eligible entitlement");
    }
  });

  it("requires consumption to follow a matching commitment", () => {
    expect(() =>
      buildMaidenEntitlementLifecycle(
        input({
          events: [
            {
              eventId: "event-1",
              revision: 1,
              action: "consume",
              tournamentId: "car-maiden",
              reason: "Unsupported shortcut",
              occurredAt: "2026-07-21T01:00:00Z",
            },
          ],
        }),
      ),
    ).toThrow("Consumption must target the committed tournament");
  });

  it("prevents a commitment from being redirected to another tournament", () => {
    expect(() =>
      buildMaidenEntitlementLifecycle(
        input({
          events: [
            {
              eventId: "event-1",
              revision: 1,
              action: "plan",
              tournamentId: "car-maiden",
              reason: "Plan",
              occurredAt: "2026-07-21T01:00:00Z",
            },
            {
              eventId: "event-2",
              revision: 2,
              action: "commit",
              tournamentId: "horse-maiden",
              reason: "Redirect",
              occurredAt: "2026-07-21T02:00:00Z",
            },
          ],
        }),
      ),
    ).toThrow("currently planned tournament");
  });

  it("requires unique IDs, sequential revisions and chronological events", () => {
    const event = {
      eventId: "same",
      revision: 1,
      action: "plan" as const,
      tournamentId: "car-maiden",
      reason: "Plan",
      occurredAt: "2026-07-21T02:00:00Z",
    };
    expect(() =>
      buildMaidenEntitlementLifecycle(
        input({
          events: [
            event,
            {
              ...event,
              revision: 2,
              action: "cancel_plan",
              occurredAt: "2026-07-21T01:00:00Z",
            },
          ],
        }),
      ),
    ).toThrow("event IDs must be unique");
    expect(() =>
      buildMaidenEntitlementLifecycle(
        input({ events: [{ ...event, revision: 2 }] }),
      ),
    ).toThrow("sequential from one");
    expect(() =>
      buildMaidenEntitlementLifecycle(
        input({
          events: [
            {
              ...event,
              occurredAt: "2026-07-19T23:59:59Z",
            },
          ],
        }),
      ),
    ).toThrow("cannot predate the imported snapshot cutoff");
  });

  it("keeps freshness warnings and timestamps auditable", () => {
    const result = buildMaidenEntitlementLifecycle(
      input({
        dataCurrentThrough: null,
        lastImported: null,
        freshness: "stale",
      }),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "DATA_CUTOFF_UNKNOWN",
        "LAST_IMPORTED_UNKNOWN",
        "IMPORTED_DATA_STALE",
        "GATE_D_NOT_PASSED",
      ]),
    );
    expect(() =>
      buildMaidenEntitlementLifecycle(
        input({
          dataCurrentThrough: "2026-07-22T00:00:00Z",
          lastImported: "2026-07-21T00:00:00Z",
        }),
      ),
    ).toThrow("Last imported cannot precede data current through");
  });
});
