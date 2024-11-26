import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { CustodyProvider } from './custody-provider.entity';

@Injectable()
export class CustodyProviderRepository extends CachedRepository<CustodyProvider> {
  constructor(manager: EntityManager) {
    super(CustodyProvider, manager);
  }

  async getByMasterKey(masterKey: string): Promise<CustodyProvider> {
    return this.findOneBy({ masterKey });
  }
}
