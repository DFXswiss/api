import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Sell } from './sell.entity';

@Injectable()
export class SellRepository extends BaseRepository<Sell> {
  constructor(manager: EntityManager) {
    super(Sell, manager);
  }
}
