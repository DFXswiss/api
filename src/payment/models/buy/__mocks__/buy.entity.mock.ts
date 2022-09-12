import { createDefaultBankAccount } from 'src/payment/models/bank-account/__mocks__/bank-account.entity.mock';
import { Deposit } from 'src/payment/models/deposit/deposit.entity';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { createDefaultUser } from 'src/user/models/user/__mocks__/user.entity.mock';
import { Buy } from '../buy.entity';

const defaultBuy: Partial<Buy> = {
  iban: 'AT00 0000 0000 0000 0000',
  bankUsage: 'XXXX-YYYY-ZZZZ',
  volume: 100,
  annualVolume: 10,
  active: true,
  user: createDefaultUser(),
  asset: createDefaultAsset(),
  deposit: null as Deposit,
  cryptoBuys: [],
  buyCryptos: [],
  bankAccount: createDefaultBankAccount(),
};

export function createDefaultBuy(): Buy {
  return createCustomBuy({});
}

export function createCustomBuy(customValues: Partial<Buy>): Buy {
  return Object.assign(new Buy(), { ...defaultBuy, ...customValues });
}
