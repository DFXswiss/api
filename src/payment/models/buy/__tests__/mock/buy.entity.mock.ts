import { createDefaultBankAccount } from 'src/payment/models/bank-account/__tests__/mock/bank-account.entity.mock';
import { Deposit } from 'src/payment/models/deposit/deposit.entity';
import { createDefaultAsset } from 'src/shared/models/asset/__tests__/mock/asset.entity.mock';
import { createDefaultUser } from 'src/user/models/user/__tests__/mock/user.entity.mock';
import { Buy } from '../../buy.entity';

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
