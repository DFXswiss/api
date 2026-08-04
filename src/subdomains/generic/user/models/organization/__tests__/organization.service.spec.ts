import { createMock } from '@golevelup/ts-jest';
import { CountryService } from 'src/shared/models/country/country.service';
import { UserDataRepository } from '../../user-data/user-data.repository';
import { OrganizationRepository } from '../organization.repository';
import { OrganizationService } from '../organization.service';

describe('OrganizationService', () => {
  let service: OrganizationService;
  let organizationRepo: jest.Mocked<Partial<OrganizationRepository>>;

  beforeEach(() => {
    organizationRepo = { findOneBy: jest.fn() };

    service = new OrganizationService(
      organizationRepo as unknown as OrganizationRepository,
      createMock<CountryService>(),
      createMock<UserDataRepository>(),
    );
  });

  describe('getOrganizationByName', () => {
    // organizationName and organizationZip are both nullable on UserData. With either absent the
    // remaining condition matches on its own, so an unrelated Organization comes back — and the
    // ORGANIZATION_SYNC cron then links it to the user.
    it.each([
      [undefined, '8000'],
      [null, '8000'],
      ['', '8000'],
      ['Acme', undefined],
      ['Acme', null],
      ['Acme', ''],
      [undefined, undefined],
    ])('does not query for name=%p zip=%p', async (name, zip) => {
      const organization = await service.getOrganizationByName(name as string, zip as string);

      expect(organization).toBeUndefined();
      expect(organizationRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('still queries when both are supplied', async () => {
      organizationRepo.findOneBy.mockResolvedValue(undefined);

      await service.getOrganizationByName('Acme', '8000');

      expect(organizationRepo.findOneBy).toHaveBeenCalledWith({ name: 'Acme', zip: '8000' });
    });
  });
});
