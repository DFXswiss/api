import { AmlError } from 'src/subdomains/core/aml/enums/aml-error.enum';

// Outcome of the Scorechain on-chain screening gate, as consumed by the AML computation.
// PASS also covers "no signal" (Scorechain disabled, unconfigured, unsupported chain, no object id):
// the tx is then decided by the other AML mechanisms, exactly as before.
export enum ScorechainOutcome {
  PASS = 'Pass',
  HIGH_RISK = 'HighRisk',
  UNAVAILABLE = 'Unavailable',
}

export const ScorechainOutcomeError: { [o in ScorechainOutcome]: AmlError | null } = {
  [ScorechainOutcome.PASS]: null,
  [ScorechainOutcome.HIGH_RISK]: AmlError.SCORECHAIN_HIGH_RISK,
  [ScorechainOutcome.UNAVAILABLE]: AmlError.SCORECHAIN_UNAVAILABLE,
};
