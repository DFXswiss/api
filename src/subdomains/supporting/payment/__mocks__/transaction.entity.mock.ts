import { createDefaultUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { createDefaultUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { Transaction, TransactionSourceType, TransactionTypeInternal } from '../entities/transaction.entity';

const defaultTransaction: Partial<Transaction> = {
  id: 1,
  sourceType: TransactionSourceType.BANK_TX,
  type: TransactionTypeInternal.BUY_CRYPTO,
  uid: 'T186C06388387A6FD',
  user: createDefaultUser(),
  userData: createDefaultUserData(),
};

export function createDefaultTransaction(): Transaction {
  return createCustomTransaction({});
}

export function createCustomTransaction(customValues: Partial<Transaction>): Transaction {
  return Object.assign(new Transaction(), { ...defaultTransaction, ...customValues });
}
