import { UserData } from '../../user-data.entity';

export function createDefaultUserData(): UserData {
  return createCustomUserData({});
}

export function createCustomUserData(customValues: Partial<UserData>): UserData {
  const { mail } = customValues;
  const keys = Object.keys(customValues);

  const entity = new UserData();

  entity.mail = keys.includes('mail') ? mail : 'test@test.com';

  return entity;
}
