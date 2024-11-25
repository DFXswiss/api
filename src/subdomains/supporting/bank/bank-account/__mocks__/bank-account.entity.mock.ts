import { createDefaultUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { BankAccount } from '../bank-account.entity';

const defaultBankAccount: Partial<BankAccount> = {
  iban: 'DE89370400440532013000',
  userData: createDefaultUserData(),
  sctInst: true,
};

export function createDefaultBankAccount(): BankAccount {
  return createCustomBankAccount({});
}

export function createCustomBankAccount(customValues: Partial<BankAccount>): BankAccount {
  return Object.assign(new BankAccount(), { ...defaultBankAccount, ...customValues });
}
