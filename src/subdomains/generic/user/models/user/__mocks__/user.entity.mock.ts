import { createDefaultUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { createDefaultWallet } from 'src/subdomains/generic/user/models/wallet/__mocks__/wallet.entity.mock';
import { User } from '../user.entity';

const defaultUser: Partial<User> = {
  id: 1,
  userData: createDefaultUserData(),
  wallet: createDefaultWallet(),
  address: 'ADDR_01',
};

export function createDefaultUser(): User {
  return createCustomUser({});
}

export function createCustomUser(customValues: Partial<User>): User {
  return Object.assign(new User(), { ...defaultUser, ...customValues });
}
