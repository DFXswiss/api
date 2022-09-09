import { createDefaultUser } from 'src/user/models/user/__tests__/mock/user.entity.mock';
import { BankAccount } from '../../bank-account.entity';

const defaultBankAccount: Partial<BankAccount> = {
  iban: 'DE89370400440532013000',
  user: createDefaultUser(),
  buys: [],
  sells: [],
  sctInst: true,
};

export function createDefaultBankAccount(): BankAccount {
  return createCustomBankAccount({});
}

export function createCustomBankAccount(customValues: Partial<BankAccount>): BankAccount {
  return Object.assign(new BankAccount(), { ...defaultBankAccount, ...customValues });
}
