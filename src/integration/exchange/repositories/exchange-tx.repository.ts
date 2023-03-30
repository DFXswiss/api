import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { ExchangeTx } from '../entities/exchange-tx.entity';

@Injectable()
export class ExchangeTxRepository extends BaseRepository<ExchangeTx> {
  constructor(manager: EntityManager) {
    super(ExchangeTx, manager);
  }
}
