import { createMock } from '@golevelup/ts-jest';
import { CountryService } from 'src/shared/models/country/country.service';
import { UserDataRepository } from '../../user-data/user-data.repository';
import { OrganizationRepository } from '../organization.repository';
import { OrganizationService } from '../organization.service';

describe('OrganizationService', () => {
  let service: OrganizationService;
  let organizationRepo: OrganizationRepository;
  let userDataRepo: UserDataRepository;

  beforeEach(() => {
    organizationRepo = createMock<OrganizationRepository>();
    userDataRepo = createMock<UserDataRepository>();

    jest.spyOn(userDataRepo, 'findBy').mockResolvedValue([]);

    service = new OrganizationService(organizationRepo, createMock<CountryService>(), userDataRepo);
  });

  describe('syncOrganization', () => {
    // Without the skip, a UserData with no organizationName falls through to createOrganization and
    // persists a nameless organisation — one per affected user, once per cron run, forever, since
    // the row keeps being re-selected while its organization stays null.
    it('skips an entity with no organization name rather than creating one', async () => {
      jest
        .spyOn(userDataRepo, 'findBy')
        .mockResolvedValue([{ id: 1, organizationName: null, organizationZip: '8000' }] as never);

      await service.syncOrganization();

      expect(organizationRepo.save).not.toHaveBeenCalled();
      expect(organizationRepo.findOneBy).not.toHaveBeenCalled();
      expect(userDataRepo.update).not.toHaveBeenCalled();
    });

    it('still processes an entity that has a name', async () => {
      jest
        .spyOn(userDataRepo, 'findBy')
        .mockResolvedValue([{ id: 1, organizationName: 'Acme', organizationZip: '8000' }] as never);
      jest.spyOn(organizationRepo, 'findOneBy').mockResolvedValue({ id: 9 } as never);

      await service.syncOrganization();

      expect(organizationRepo.findOneBy).toHaveBeenCalledWith({ name: 'Acme', zip: '8000' });
    });
  });

  describe('getOrganizationByName', () => {
    // organizationName and organizationZip are both nullable on UserData. With either absent the
    // remaining condition matches on its own, so an unrelated Organization comes back — and the
    // ORGANIZATION_SYNC cron then links it to the user.
    it.each([undefined, null, ''])('does not query when the name is %p', async (name) => {
      const organization = await service.getOrganizationByName(name as string, '8000');

      expect(organization).toBeUndefined();
      expect(organizationRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('still queries when both are supplied', async () => {
      jest.spyOn(organizationRepo, 'findOneBy').mockResolvedValue(undefined);

      await service.getOrganizationByName('Acme', '8000');

      expect(organizationRepo.findOneBy).toHaveBeenCalledWith({ name: 'Acme', zip: '8000' });
    });

    // An absent zip must NOT short-circuit: the name still scopes the query, and matching every zip
    // for that name is the deduplication the sync cron depends on. Requiring zip made it create a
    // duplicate organisation per colleague instead.
    it.each([undefined, null, ''])('still queries with a name when the zip is %p', async (zip) => {
      jest.spyOn(organizationRepo, 'findOneBy').mockResolvedValue(undefined);

      await service.getOrganizationByName('Acme', zip as string);

      expect(organizationRepo.findOneBy).toHaveBeenCalledWith({ name: 'Acme', zip });
    });
  });
});
