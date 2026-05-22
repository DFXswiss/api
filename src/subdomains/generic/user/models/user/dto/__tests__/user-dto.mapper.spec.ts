import { ConfigService } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { Language } from 'src/shared/models/language/language.entity';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { Organization } from '../../../organization/organization.entity';
import { AccountType } from '../../../user-data/account-type.enum';
import { UserData } from '../../../user-data/user-data.entity';
import { KycLevel, UserDataStatus } from '../../../user-data/user-data.enum';
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
      expect(result.organizationName).toBeUndefined();
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
        organization: org,
      });

      const result = UserDtoMapper.mapProfile(userData);

      expect(result.accountType).toBe(AccountType.ORGANIZATION);
      // Address should be organization address (from userData.address getter)
      expect(result.address.street).toBe('Firmenstrasse');
      expect(result.address.city).toBe('Bern');
      // Organization data should come from organization entity
      expect(result.organizationName).toBeDefined();
      expect(result.organizationName).toBe('Test AG');
    });

    it('should return undefined organization when not set', () => {
      const userData = createUserData({ organization: undefined });

      const result = UserDtoMapper.mapProfile(userData);

      expect(result.organizationName).toBeUndefined();
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

  // Capability flags surfaced for client-side UI gating, replacing the
  // settings/support widgets' status interpretation. See realunit-app
  // `docs/api-authority-plan.md` (Wave 3).
  describe('mapUser: capabilities', () => {
    beforeAll(() => {
      new ConfigService();
    });

    const buildLanguage = (): Language => {
      const lang = new Language();
      lang.symbol = 'EN';
      lang.name = 'English';
      lang.foreignName = 'English';
      lang.enable = true;
      return lang;
    };

    const buildStep = (name: KycStepName, status: ReviewStatus): KycStep => {
      const step = new KycStep();
      step.name = name;
      step.status = status;
      step.sequenceNumber = 0;
      return step;
    };

    const buildUserData = (overrides: Partial<UserData> = {}): UserData => {
      const userData = new UserData();
      userData.id = 1;
      userData.kycHash = 'h';
      userData.status = UserDataStatus.ACTIVE;
      userData.accountType = AccountType.PERSONAL;
      userData.mail = 'john@example.com';
      userData.kycLevel = KycLevel.LEVEL_20;
      userData.language = buildLanguage();
      userData.currency = createDefaultFiat();
      userData.users = [];
      userData.kycSteps = [];
      return Object.assign(userData, overrides);
    };

    it('canEditName is true when no PersonalData step has been reviewed yet', () => {
      const result = UserDtoMapper.mapUser(buildUserData());

      expect(result.capabilities.canEditName).toBe(true);
      expect(result.capabilities.canEditAddress).toBe(true);
    });

    it('canEditName is false once PersonalData is completed', () => {
      const userData = buildUserData();
      userData.kycSteps = [buildStep(KycStepName.PERSONAL_DATA, ReviewStatus.COMPLETED)];

      const result = UserDtoMapper.mapUser(userData);

      expect(result.capabilities.canEditName).toBe(false);
      expect(result.capabilities.canEditAddress).toBe(false);
    });

    it('canEditName is false while PersonalData is in review', () => {
      const userData = buildUserData();
      userData.kycSteps = [buildStep(KycStepName.PERSONAL_DATA, ReviewStatus.MANUAL_REVIEW)];

      const result = UserDtoMapper.mapUser(userData);

      expect(result.capabilities.canEditName).toBe(false);
    });

    it('supportAvailable mirrors whether the user has a mail set', () => {
      const withMail = UserDtoMapper.mapUser(buildUserData());
      const withoutMail = UserDtoMapper.mapUser(buildUserData({ mail: undefined }));

      expect(withMail.capabilities.supportAvailable).toBe(true);
      expect(withoutMail.capabilities.supportAvailable).toBe(false);
    });

    it('all edit flags collapse to false on KYC-terminated accounts', () => {
      const result = UserDtoMapper.mapUser(buildUserData({ kycLevel: KycLevel.REJECTED }));

      expect(result.capabilities.canEditMail).toBe(false);
      expect(result.capabilities.canEditPhone).toBe(false);
    });
  });
});
