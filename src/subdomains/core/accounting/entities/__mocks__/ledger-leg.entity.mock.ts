import { LedgerLeg } from '../ledger-leg.entity';

const defaultLedgerLeg: Partial<LedgerLeg> = {
  id: 1,
  amount: 0,
  amountChfCents: 0,
  needsMark: false,
};

export function createDefaultLedgerLeg(): LedgerLeg {
  return createCustomLedgerLeg({});
}

export function createCustomLedgerLeg(customValues: Partial<LedgerLeg>): LedgerLeg {
  return Object.assign(new LedgerLeg(), { ...defaultLedgerLeg, ...customValues });
}
