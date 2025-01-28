import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Integrator } from './integrator.entity';

@Injectable()
export class IntegratorRepository extends CachedRepository<Integrator> {
  constructor(manager: EntityManager) {
    super(Integrator, manager);
  }
}
