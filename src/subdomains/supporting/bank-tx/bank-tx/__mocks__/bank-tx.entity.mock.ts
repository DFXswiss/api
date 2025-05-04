import { BankTx } from '../entities/bank-tx.entity';
import { createDefaultBankTxBatch } from './bank-tx-batch.entity.mock';

const defaultBankTx: Partial<BankTx> = {
  batch: createDefaultBankTxBatch(),
};

export function createDefaultBankTx(): BankTx {
  return createCustomBankTx({ id: 1, amount: 100, iban: 'DE12500105170648489890', chargeAmountChf: 0 });
}

export function createCustomBankTx(customValues: Partial<BankTx>): BankTx {
  return Object.assign(new BankTx(), { ...defaultBankTx, ...customValues });
}
