import { BankTxBatch } from '../entities/bank-tx-batch.entity';

const defaultBankTxBatch: Partial<BankTxBatch> = {
  transactions: [],
};

export function createDefaultBankTxBatch(): BankTxBatch {
  return createCustomBankTxBatch({});
}

export function createCustomBankTxBatch(customValues: Partial<BankTxBatch>): BankTxBatch {
  return Object.assign(new BankTxBatch(), { ...defaultBankTxBatch, ...customValues });
}
