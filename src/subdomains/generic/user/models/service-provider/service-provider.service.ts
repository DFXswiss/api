import { Injectable, NotFoundException } from '@nestjs/common';

import { ServiceProviderDto } from './dto/service-provider.dto';
import { ServiceProvider } from './service-provider.entity';
import { ServiceProviderRepository } from './service-provider.repository';

@Injectable()
export class ServiceProviderService {
  constructor(private readonly repo: ServiceProviderRepository) {}

  async createServiceProvider(dto: ServiceProviderDto): Promise<ServiceProvider> {
    const entity = this.repo.create(dto);

    return this.repo.save(entity);
  }

  async updateServiceProvider(id: number, dto: ServiceProviderDto): Promise<ServiceProvider> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Service provider not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }

  async getWithMasterKey(masterKey: string): Promise<ServiceProvider | undefined> {
    return masterKey && this.repo.findOneCachedBy(masterKey, { masterKey });
  }
}
