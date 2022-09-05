import { createDefaultBankAccount } from 'src/payment/models/bank-account/__mocks__/bank-account.entity.mock';
import { createDefaultDeposit } from 'src/payment/models/deposit/__mocks__/deposit.entity.mock';
import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { createDefaultUser } from 'src/user/models/user/__mocks__/user.entity.mock';
import { Sell } from '../sell.entity';

const defaultSell: Partial<Sell> = {
  iban: 'DE89370400440532013000',
  fiat: createDefaultFiat(),
  annualVolume: 0,
  user: createDefaultUser(),
  bankAccount: createDefaultBankAccount(),
  cryptoInputs: [],
  buyFiats: [],
  deposit: createDefaultDeposit(),
};

export function createDefaultSell(): Sell {
  return createCustomSell({});
}

export function createCustomSell(customValues: Partial<Sell>): Sell {
  return Object.assign(new Sell(), { ...defaultSell, ...customValues });
}
