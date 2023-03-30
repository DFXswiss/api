import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager, SaveOptions } from 'typeorm';
import { BankTx } from './bank-tx.entity';

@Injectable()
export class BankTxRepository extends BaseRepository<BankTx> {
  constructor(manager: EntityManager) {
    super(BankTx, manager);
  }

  async saveMany(entities: BankTx[], options?: SaveOptions): Promise<BankTx[]> {
    const results = [];

    // store in batches
    const batchSize = 50;
    do {
      const batch = entities.slice(0, batchSize);
      entities = entities.slice(batchSize);

      results.concat(await super.save(batch, options));
    } while (entities.length > 0);

    return results;
  }

  async setNewUpdateTime(bankTxId: number): Promise<void> {
    await this.update(bankTxId, { updated: new Date() });
  }
}
