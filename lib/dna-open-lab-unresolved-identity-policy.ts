export const DNA_OPEN_LAB_OWNER_AUTHORIZED_DE_MINIMIS_IDENTITY_OMISSION_LIMIT =
  25 as const;

export const DNA_OPEN_LAB_UNRESOLVED_IDENTITY_CRITICAL_NOTIFICATION_THRESHOLD =
  1_000 as const;

export type DnaOpenLabUnresolvedIdentityDisposition =
  | "none"
  | "owner_authorized_de_minimis_candidate"
  | "owner_review_required"
  | "critical_volume_notification_required";

/**
 * Classifies only the aggregate conservative measurement bound. It does not
 * itself authorize persistence or omission; the persistent worker must still
 * enforce the measured bound, quarantine every omitted observation and record
 * the omission in its accepted-window evidence.
 */
export function classifyDnaOpenLabUnresolvedIdentityObservations(
  unresolvedIdentityObservationUpperBound: number,
): DnaOpenLabUnresolvedIdentityDisposition {
  if (
    !Number.isSafeInteger(unresolvedIdentityObservationUpperBound) ||
    unresolvedIdentityObservationUpperBound < 0
  ) {
    throw new Error(
      "DNA Open Lab unresolved identity observation bound is invalid.",
    );
  }
  if (unresolvedIdentityObservationUpperBound === 0) return "none";
  if (
    unresolvedIdentityObservationUpperBound <=
    DNA_OPEN_LAB_OWNER_AUTHORIZED_DE_MINIMIS_IDENTITY_OMISSION_LIMIT
  ) {
    return "owner_authorized_de_minimis_candidate";
  }
  if (
    unresolvedIdentityObservationUpperBound >=
    DNA_OPEN_LAB_UNRESOLVED_IDENTITY_CRITICAL_NOTIFICATION_THRESHOLD
  ) {
    return "critical_volume_notification_required";
  }
  return "owner_review_required";
}
