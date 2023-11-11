import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CheckoutTx } from '../entities/checkout-tx.entity';

@Injectable()
export class CheckoutTxRepository extends BaseRepository<CheckoutTx> {
  constructor(manager: EntityManager) {
    super(CheckoutTx, manager);
  }
}
