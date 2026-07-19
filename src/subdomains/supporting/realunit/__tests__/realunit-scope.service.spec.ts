import { NotFoundException } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { ServiceProvider, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { RealUnitScopeService } from 'src/subdomains/supporting/realunit/realunit-scope.service';

describe('RealUnitScopeService', () => {
  let service: RealUnitScopeService;
  let userDataService: DeepMocked<UserDataService>;

  const realUnitCustomer = Object.assign(new UserData(), { id: 1, serviceProviders: ServiceProvider.REALUNIT });
  const dfxCustomer = Object.assign(new UserData(), { id: 2, serviceProviders: undefined });

  beforeEach(() => {
    userDataService = createMock<UserDataService>();
    service = new RealUnitScopeService(userDataService);
  });

  describe('isCustomer', () => {
    it('returns true for a RealUnit customer', async () => {
      userDataService.getUserData.mockResolvedValue(realUnitCustomer);
      await expect(service.isCustomer(1)).resolves.toBe(true);
    });

    it('returns false for a non-RealUnit account', async () => {
      userDataService.getUserData.mockResolvedValue(dfxCustomer);
      await expect(service.isCustomer(2)).resolves.toBe(false);
    });

    it('returns false (fail-closed) for an unknown account', async () => {
      userDataService.getUserData.mockResolvedValue(null);
      await expect(service.isCustomer(999)).resolves.toBe(false);
    });

    it('returns false for a merged tombstone that kept its marker (master represents it)', async () => {
      const mergedSlave = Object.assign(new UserData(), {
        id: 3,
        serviceProviders: ServiceProvider.REALUNIT,
        status: UserDataStatus.MERGED,
      });
      userDataService.getUserData.mockResolvedValue(mergedSlave);
      await expect(service.isCustomer(3)).resolves.toBe(false);
    });
  });

  describe('assertCustomer', () => {
    it('resolves for a RealUnit customer', async () => {
      userDataService.getUserData.mockResolvedValue(realUnitCustomer);
      await expect(service.assertCustomer(1)).resolves.toBeUndefined();
    });

    it('throws NotFound for a non-member (tenant isolation, no existence leak)', async () => {
      userDataService.getUserData.mockResolvedValue(dfxCustomer);
      await expect(service.assertCustomer(2)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound for an unknown account', async () => {
      userDataService.getUserData.mockResolvedValue(null);
      await expect(service.assertCustomer(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
