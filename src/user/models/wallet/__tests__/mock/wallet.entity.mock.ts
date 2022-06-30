import { Wallet } from '../../wallet.entity';

export function createDefaultWallet(): Wallet {
  return createCustomWallet({});
}

export function createCustomWallet(customValues: Partial<Wallet>): Wallet {
  const { address } = customValues;
  const keys = Object.keys(customValues);

  const entity = new Wallet();

  entity.address = keys.includes('address') ? address : 'x0ZZZYYY';

  return entity;
}
