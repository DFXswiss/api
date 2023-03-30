import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BankTx } from './bank-tx.entity';

@Injectable()
export class BankTxRepository extends BaseRepository<BankTx> {
  constructor(manager: EntityManager) {
    super(BankTx, manager);
  }

  async setNewUpdateTime(bankTxId: number): Promise<void> {
    await this.update(bankTxId, { updated: new Date() });
  }
}
