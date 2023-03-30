import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Fiat } from './fiat.entity';

@Injectable()
export class FiatRepository extends BaseRepository<Fiat> {
  constructor(manager: EntityManager) {
    super(Fiat, manager);
  }
}
