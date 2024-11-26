import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { ServiceProvider } from './service-provider.entity';

@Injectable()
export class ServiceProviderRepository extends CachedRepository<ServiceProvider> {
  constructor(manager: EntityManager) {
    super(ServiceProvider, manager);
  }

  async getByMasterKey(masterKey: string): Promise<ServiceProvider> {
    return this.findOneBy({ masterKey });
  }
}
