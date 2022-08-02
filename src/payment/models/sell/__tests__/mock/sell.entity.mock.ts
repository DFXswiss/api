import { createDefaultBankAccount } from 'src/payment/models/bank-account/__tests__/mock/bank-account.entity.mock';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { createDefaultUser } from 'src/user/models/user/__tests__/mock/user.entity.mock';
import { Sell } from '../../sell.entity';

// TODO: move to own mock file
function createDefaultFiat(): Fiat {
  return { ...new Fiat(), name: 'EUR', enable: true };
}

const defaultSell: Partial<Sell> = {
  iban: 'DE89370400440532013000',
  fiat: createDefaultFiat(),
  annualVolume: 0,
  user: createDefaultUser(),
  bankAccount: createDefaultBankAccount(),
  cryptoInputs: [],
  buyFiats: [],
};

export function createDefaultSell(): Sell {
  return createCustomSell({});
}

export function createCustomSell(customValues: Partial<Sell>): Sell {
  return { ...new Sell(), ...defaultSell, ...customValues };
}
