import { createDefaultCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { createDefaultLanguage } from 'src/shared/models/language/__mocks__/language.entity.mock';
import { AccountType } from '../account-type.enum';
import { UserData } from '../user-data.entity';
import { KycLevel, KycType } from '../user-data.enum';

export enum MockUserData {
  CLEAN_DB,
  EMPTY,
  COMPLETE,
  STARTED,
}

const defaultUserData: Partial<UserData> = {
  id: 1,
  mail: 'test@test.com',
  users: [],
  country: createDefaultCountry(),
  language: createDefaultLanguage(),
};

export function createDefaultUserData(): UserData {
  return createCustomUserData({});
}

export function createCustomUserData(customValues: Partial<UserData>): UserData {
  return Object.assign(new UserData(), { ...defaultUserData, ...customValues });
}

export function createUserDataFor(mock: MockUserData): UserData | undefined {
  switch (mock) {
    case MockUserData.CLEAN_DB:
      return undefined;
    case MockUserData.EMPTY:
      return createCustomUserData({
        id: userDataIdFor(mock),
        kycHash: kycHashFor(mock),
        kycLevel: KycLevel.LEVEL_0,
        kycType: KycType.DFX,
        mail: undefined,
      });
    case MockUserData.COMPLETE:
    case MockUserData.STARTED:
      return createCustomUserData({
        id: userDataIdFor(mock),
        kycHash: kycHashFor(mock),
        kycLevel: mock === MockUserData.STARTED ? KycLevel.LEVEL_20 : KycLevel.LEVEL_0,
        kycType: KycType.DFX,
        firstname: 'FirstUserName',
        surname: 'SurUsername',
        country: createDefaultCountry(),
        accountType: AccountType.PERSONAL,
        mail: 'test@test.com',
        phone: '+49 123456789',
        depositLimit: 90000,
        street: 'Street',
        houseNumber: '42',
        location: 'Location',
        zip: '43210',
      });
    default:
      return createDefaultUserData();
  }
}

export function kycHashFor(mock: MockUserData): string {
  switch (mock) {
    case MockUserData.EMPTY:
      return 'F1D9C830-0D80-11ED-AA05-0800200C9A66';
    case MockUserData.COMPLETE:
    case MockUserData.STARTED:
      return 'C12508A0-0D83-11ED-AA05-0800200C9A66';
  }
}

export function userDataIdFor(mock: MockUserData): number {
  switch (mock) {
    case MockUserData.EMPTY:
      return 1;
    case MockUserData.COMPLETE:
    case MockUserData.STARTED:
      return 2;
  }
}
