import { Injectable, NotFoundException } from '@nestjs/common';
import { ServiceProvider } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';

// Resolves the RealUnit tenant customer scope from the persisted UserData.serviceProviders marker (NOT the
// unreliable User.wallet). Everything is fail-closed: an empty scope yields an empty result, never unrestricted,
// and a non-member id is treated as a missing resource (404) so tenant boundaries never leak existence.
@Injectable()
export class RealunitScopeService {
  constructor(private readonly userDataService: UserDataService) {}

  async getCustomerIds(): Promise<number[]> {
    return this.userDataService.getUserDataIdsByServiceProvider(ServiceProvider.REALUNIT);
  }

  async isCustomer(userDataId: number): Promise<boolean> {
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData) return false; // fail-closed: an unknown account is not a RealUnit customer
    return userData.isRealUnitCustomer;
  }

  async assertCustomer(userDataId: number): Promise<void> {
    if (!(await this.isCustomer(userDataId))) throw new NotFoundException('Not found');
  }
}
