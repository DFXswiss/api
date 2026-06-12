import { AccountType, LedgerAccount } from '../ledger-account.entity';

const defaultLedgerAccount: Partial<LedgerAccount> = {
  id: 1,
  name: 'EQUITY/opening-balance',
  type: AccountType.EQUITY,
  currency: 'CHF',
  active: true,
};

export function createDefaultLedgerAccount(): LedgerAccount {
  return createCustomLedgerAccount({});
}

export function createCustomLedgerAccount(customValues: Partial<LedgerAccount>): LedgerAccount {
  return Object.assign(new LedgerAccount(), { ...defaultLedgerAccount, ...customValues });
}
