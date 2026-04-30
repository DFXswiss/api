import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Fiat } from './fiat.entity';

@Injectable()
export class FiatRepository extends CachedRepository<Fiat> {
  constructor(manager: EntityManager) {
    super(Fiat, manager);
  }
}
