import { BankAccount } from '../bank-account.entity';

const defaultBankAccount: Partial<BankAccount> = {
  iban: 'DE89370400440532013000',
  sctInst: true,
};

export function createDefaultBankAccount(): BankAccount {
  return createCustomBankAccount({});
}

export function createCustomBankAccount(customValues: Partial<BankAccount>): BankAccount {
  return Object.assign(new BankAccount(), { ...defaultBankAccount, ...customValues });
}
