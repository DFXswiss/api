import { Deposit } from 'src/payment/models/deposit/deposit.entity';
import { createDefaultAsset } from 'src/shared/models/asset/__tests__/mock/asset.entity.mock';
import { createDefaultUser } from 'src/user/models/user/__tests__/mock/user.entity.mock';
import { Buy } from '../../buy.entity';

export function createDefaultBuy(): Buy {
  return createCustomBuy({});
}

export function createCustomBuy(customValues: Partial<Buy>): Buy {
  const { iban, bankUsage, volume, annualVolume, active, user, asset, deposit, cryptoBuys, buyCryptos } = customValues;
  const keys = Object.keys(customValues);

  const entity = new Buy();

  entity.iban = keys.includes('iban') ? iban : 'AT00 0000 0000 0000 0000';
  entity.bankUsage = keys.includes('bankUsage') ? bankUsage : 'XXXX-YYYY-ZZZZ';
  entity.volume = keys.includes('volume') ? volume : 100;
  entity.annualVolume = keys.includes('annualVolume') ? annualVolume : 10;
  entity.active = keys.includes('active') ? active : true;
  entity.user = keys.includes('user') ? user : createDefaultUser();
  entity.asset = keys.includes('asset') ? asset : createDefaultAsset();
  entity.deposit = keys.includes('deposit') ? deposit : (null as Deposit); // not used in the tests atm
  entity.cryptoBuys = keys.includes('cryptoBuys') ? cryptoBuys : [];
  entity.buyCryptos = keys.includes('buyCryptos') ? buyCryptos : [];

  return entity;
}
