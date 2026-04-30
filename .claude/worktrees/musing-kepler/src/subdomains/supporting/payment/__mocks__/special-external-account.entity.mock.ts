import { SpecialExternalAccount, SpecialExternalAccountType } from '../entities/special-external-account.entity';

const defaultSpecialExternalAccount: Partial<SpecialExternalAccount> = {
  id: 1,
  type: SpecialExternalAccountType.MULTI_ACCOUNT_IBAN,
  value: 'DE12345',
};

export function createDefaultSpecialExternalAccount(): SpecialExternalAccount {
  return createCustomSpecialExternalAccount({});
}

export function createCustomSpecialExternalAccount(
  customValues: Partial<SpecialExternalAccount>,
): SpecialExternalAccount {
  return Object.assign(new SpecialExternalAccount(), { ...defaultSpecialExternalAccount, ...customValues });
}
