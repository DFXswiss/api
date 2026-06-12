import { LedgerTx } from '../ledger-tx.entity';

const defaultLedgerTx: Partial<LedgerTx> = {
  id: 1,
  sourceType: 'manual',
  sourceId: '1',
  seq: 0,
  bookingDate: new Date('2026-06-01'),
  valueDate: new Date('2026-06-01'),
  amountChfSum: 0,
};

export function createDefaultLedgerTx(): LedgerTx {
  return createCustomLedgerTx({});
}

export function createCustomLedgerTx(customValues: Partial<LedgerTx>): LedgerTx {
  return Object.assign(new LedgerTx(), { ...defaultLedgerTx, ...customValues });
}
