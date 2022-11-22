import { createDefaultUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { createDefaultWallet } from 'src/subdomains/generic/user/models/wallet/__mocks__/wallet.entity.mock';
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
