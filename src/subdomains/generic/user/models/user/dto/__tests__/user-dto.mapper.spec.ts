import { Country } from 'src/shared/models/country/country.entity';
import { AccountType } from '../../../user-data/account-type.enum';
import { UserData } from '../../../user-data/user-data.entity';
import { UserDataStatus } from '../../../user-data/user-data.enum';
import { Organization } from '../../../organization/organization.entity';
import { UserDtoMapper } from '../user-dto.mapper';

describe('UserDtoMapper', () => {
  describe('mapProfile', () => {
    const createCountry = (symbol: string): Country => {
      const country = new Country();
      country.symbol = symbol;
      country.name = symbol;
      return country;
    };

    const createUserData = (overrides: Partial<UserData> = {}): UserData => {
      const userData = new UserData();
      userData.id = 1;
      userData.status = UserDataStatus.ACTIVE;
      userData.accountType = AccountType.PERSONAL;
      userData.firstname = 'John';
      userData.surname = 'Doe';
      userData.mail = 'john@example.com';
      userData.phone = '+41791234567';
      userData.street = 'Teststrasse';
      userData.houseNumber = '1';
      userData.location = 'Zurich';
      userData.zip = '8000';
      userData.country = createCountry('CH');
      return Object.assign(userData, overrides);
    };

    it('should map personal account profile', () => {
      const userData = createUserData();

      const result = UserDtoMapper.mapProfile(userData);

      expect(result.accountType).toBe(AccountType.PERSONAL);
      expect(result.firstName).toBe('John');
      expect(result.lastName).toBe('Doe');
      expect(result.mail).toBe('john@example.com');
      expect(result.phone).toBe('+41791234567');
      expect(result.address).toBeDefined();
      expect(result.address.street).toBe('Teststrasse');
      expect(result.address.city).toBe('Zurich');
      expect(result.organization).toBeUndefined();
    });

    it('should map organization account profile with organization data', () => {
      const org = new Organization();
      org.name = 'Test AG';
      org.street = 'Firmenstrasse';
      org.houseNumber = '99';
      org.location = 'Bern';
      org.zip = '3000';
      org.country = createCountry('CH');

      const userData = createUserData({
        accountType: AccountType.ORGANIZATION,
        organizationStreet: 'Firmenstrasse',
        organizationHouseNumber: '99',
        organizationLocation: 'Bern',
        organizationZip: '3000',
        organizationCountry: createCountry('CH'),
        organization: org,
      });

      const result = UserDtoMapper.mapProfile(userData);

      expect(result.accountType).toBe(AccountType.ORGANIZATION);
      // Address should be organization address (from userData.address getter)
      expect(result.address.street).toBe('Firmenstrasse');
      expect(result.address.city).toBe('Bern');
      // Organization data should come from organization entity
      expect(result.organization).toBeDefined();
      expect(result.organization.name).toBe('Test AG');
      expect(result.organization.address.street).toBe('Firmenstrasse');
    });

    it('should return undefined organization when not set', () => {
      const userData = createUserData({ organization: undefined });

      const result = UserDtoMapper.mapProfile(userData);

      expect(result.organization).toBeUndefined();
    });

    it('should handle empty address fields', () => {
      const userData = createUserData({
        street: undefined,
        houseNumber: undefined,
        location: undefined,
        zip: undefined,
        country: undefined,
      });

      const result = UserDtoMapper.mapProfile(userData);

      expect(result.address).toBeUndefined();
    });
  });
});
