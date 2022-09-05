import { createDefaultUserData } from 'src/user/models/user-data/__tests__/mock/user-data.entity.mock';
import { createDefaultWallet } from 'src/user/models/wallet/__tests__/mock/wallet.entity.mock';
import { User } from '../user.entity';

export function createDefaultUser(): User {
  return createCustomUser({});
}

export function createCustomUser(customValues: Partial<User>): User {
  const { userData, wallet, address } = customValues;
  const keys = Object.keys(customValues);

  const entity = new User();

  entity.userData = keys.includes('userData') ? userData : createDefaultUserData();
  entity.wallet = keys.includes('wallet') ? wallet : createDefaultWallet();
  entity.address = keys.includes('address') ? address : 'ADDR_01';

  return entity;
}
