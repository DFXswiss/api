import { createDefaultCountry } from 'src/shared/models/country/__tests__/mock/country.entity.mock';
import { AccountType } from '../../account-type.enum';
import { KycState, KycStatus, UserData } from '../../user-data.entity';

export enum MockUserData {
  CLEAN_DB,
  EMPTY,
  COMPLETE,
  STARTED,
}

export function createDefaultUserData(): UserData {
  return createCustomUserData({});
}

export function createCustomUserData(customValues: Partial<UserData>): UserData {
  const { mail } = customValues;
  const keys = Object.keys(customValues);

  const entity = new UserData();

  entity.mail = keys.includes('mail') ? mail : 'test@test.com';
  entity.country = createDefaultCountry();

  return entity;
}

export function createUserDataFor(mock: MockUserData): UserData | undefined {
  switch (mock) {
    case MockUserData.CLEAN_DB:
      return undefined;
    case MockUserData.EMPTY:
      return {
        id: userDataIdFor(mock),
        kycHash: kycHashFor(mock),
        kycState: KycState.NA,
        kycStatus: KycStatus.NA,
        depositLimit: 90000,
      } as UserData;
    case MockUserData.COMPLETE:
    case MockUserData.STARTED:
      return {
        id: userDataIdFor(mock),
        kycHash: kycHashFor(mock),
        kycState: KycState.NA,
        kycStatus: mock === MockUserData.STARTED ? KycStatus.CHATBOT : KycStatus.NA,
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
      } as UserData;
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
