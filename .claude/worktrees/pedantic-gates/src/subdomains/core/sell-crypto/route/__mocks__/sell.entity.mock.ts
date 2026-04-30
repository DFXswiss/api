import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { createDefaultUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { createDefaultDeposit } from 'src/subdomains/supporting/address-pool/deposit/__mocks__/deposit.entity.mock';
import { Sell } from '../sell.entity';

const defaultSell: Partial<Sell> = {
  iban: 'DE89370400440532013000',
  fiat: createDefaultFiat(),
  annualVolume: 0,
  user: createDefaultUser(),
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
