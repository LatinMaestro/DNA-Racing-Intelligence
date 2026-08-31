import { createHash } from "node:crypto";

import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "./dna-open-lab-p5-private-preview-recovery";
import type { DnaOpenLabP5RecoveryNeonSafetySnapshot } from "./neon-dna-open-lab-p5-recovery-safety-port";
import type { DnaOpenLabP5RecoveryR2SafetySnapshot } from "./cloudflare-dna-open-lab-p5-recovery-safety-port";

export type DnaOpenLabP5RecoveryProviderSafetyConfiguration = Readonly<{
  inspectNeon: () => Promise<DnaOpenLabP5RecoveryNeonSafetySnapshot>;
  inspectR2: () => Promise<DnaOpenLabP5RecoveryR2SafetySnapshot>;
  cleanupR2SyntheticCase: () => Promise<void>;
}>;

function safetyError(): never {
  throw new Error("DNA Open Lab P5 provider recovery safety failed.");
}

function sha256(value: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) safetyError();
  return value;
}

function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) safetyError();
  return value;
}

/** Composes the read-only Neon and private R2 boundaries used by the guard. */
export function createDnaOpenLabP5RecoveryProviderSafety(
  configuration: DnaOpenLabP5RecoveryProviderSafetyConfiguration,
): Readonly<{
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
}> {
  if (
    typeof configuration.inspectNeon !== "function" ||
    typeof configuration.inspectR2 !== "function" ||
    typeof configuration.cleanupR2SyntheticCase !== "function"
  ) {
    safetyError();
  }
  return Object.freeze({
    async inspectProviderSafety() {
      try {
        const [neon, r2] = await Promise.all([
          configuration.inspectNeon(),
          configuration.inspectR2(),
        ]);
        const neonRetained = sha256(neon.retainedEvidenceSha256);
        const r2Retained = sha256(r2.retainedEvidenceSha256);
        return Object.freeze({
          ownerDataSha256: sha256(neon.ownerDataSha256),
          checkpointStateSha256: sha256(neon.checkpointStateSha256),
          servingStateSha256: sha256(neon.servingStateSha256),
          retainedEvidenceSha256: createHash("sha256")
            .update(
              `dna-open-lab-p5-provider-retained-evidence\u0000${neonRetained}\u0000${r2Retained}`,
              "utf8",
            )
            .digest("hex"),
          persistentOwnerDataRowCount: count(neon.persistentOwnerDataRowCount),
          syntheticResidueObjectCount: count(r2.syntheticResidueObjectCount),
        });
      } catch {
        return safetyError();
      }
    },
    async cleanupSyntheticCase() {
      try {
        await configuration.cleanupR2SyntheticCase();
      } catch {
        return safetyError();
      }
    },
  });
}
