import { createDefaultWallet } from 'src/user/models/wallet/__tests__/mock/wallet.entity.mock';
import { User } from '../../user.entity';

export function createDefaultUser(): User {
  return createCustomUser({});
}

export function createCustomUser(customValues: Partial<User>): User {
  const { wallet } = customValues;
  const keys = Object.keys(customValues);

  const entity = new User();

  entity.wallet = keys.includes('wallet') ? wallet : createDefaultWallet();

  return entity;
}
