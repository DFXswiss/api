import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Buy } from './buy.entity';

@Injectable()
export class BuyRepository extends BaseRepository<Buy> {
  constructor(manager: EntityManager) {
    super(Buy, manager);
  }
}
