import { describe, expect, it } from "vitest";

import {
  classifyDnaOpenLabUnresolvedIdentityObservations,
  DNA_OPEN_LAB_OWNER_AUTHORIZED_DE_MINIMIS_IDENTITY_OMISSION_LIMIT,
  DNA_OPEN_LAB_UNRESOLVED_IDENTITY_CRITICAL_NOTIFICATION_THRESHOLD,
} from "@/lib/dna-open-lab-unresolved-identity-policy";

describe("DNA Open Lab unresolved identity policy", () => {
  it("classifies zero and the bounded owner-authorized de minimis range", () => {
    expect(classifyDnaOpenLabUnresolvedIdentityObservations(0)).toBe("none");
    expect(classifyDnaOpenLabUnresolvedIdentityObservations(1)).toBe(
      "owner_authorized_de_minimis_candidate",
    );
    expect(
      classifyDnaOpenLabUnresolvedIdentityObservations(
        DNA_OPEN_LAB_OWNER_AUTHORIZED_DE_MINIMIS_IDENTITY_OMISSION_LIMIT,
      ),
    ).toBe("owner_authorized_de_minimis_candidate");
  });

  it("requires review above the de minimis limit and a critical notification at one thousand", () => {
    expect(
      classifyDnaOpenLabUnresolvedIdentityObservations(
        DNA_OPEN_LAB_OWNER_AUTHORIZED_DE_MINIMIS_IDENTITY_OMISSION_LIMIT + 1,
      ),
    ).toBe("owner_review_required");
    expect(
      classifyDnaOpenLabUnresolvedIdentityObservations(
        DNA_OPEN_LAB_UNRESOLVED_IDENTITY_CRITICAL_NOTIFICATION_THRESHOLD - 1,
      ),
    ).toBe("owner_review_required");
    expect(
      classifyDnaOpenLabUnresolvedIdentityObservations(
        DNA_OPEN_LAB_UNRESOLVED_IDENTITY_CRITICAL_NOTIFICATION_THRESHOLD,
      ),
    ).toBe("critical_volume_notification_required");
  });

  it("rejects invalid aggregate bounds", () => {
    expect(() => classifyDnaOpenLabUnresolvedIdentityObservations(-1)).toThrow(
      "bound is invalid",
    );
    expect(() => classifyDnaOpenLabUnresolvedIdentityObservations(1.5)).toThrow(
      "bound is invalid",
    );
  });
});
