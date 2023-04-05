import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CryptoRoute } from './crypto-route.entity';

@Injectable()
export class CryptoRouteRepository extends BaseRepository<CryptoRoute> {
  constructor(manager: EntityManager) {
    super(CryptoRoute, manager);
  }
}
