import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { DepositRoute } from './deposit-route.entity';

@Injectable()
export class DepositRouteRepository extends BaseRepository<DepositRoute> {
  constructor(manager: EntityManager) {
    super(DepositRoute, manager);
  }
}
