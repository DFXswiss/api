import { Injectable, NotFoundException } from '@nestjs/common';

import { CustodyProvider } from './custody-provider.entity';
import { CustodyProviderRepository } from './custody-provider.repository';
import { CustodyProviderDto } from './dto/custody-provider.dto';

@Injectable()
export class CustodyProviderService {
  constructor(private readonly repo: CustodyProviderRepository) {}

  async createCustodyProvider(dto: CustodyProviderDto): Promise<CustodyProvider> {
    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async updateCustodyProvider(id: number, dto: CustodyProviderDto): Promise<CustodyProvider> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Custody provider not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }

  async getWithMasterKey(masterKey: string): Promise<CustodyProvider | undefined> {
    return masterKey && this.repo.findOneCachedBy(masterKey, { masterKey });
  }
}
