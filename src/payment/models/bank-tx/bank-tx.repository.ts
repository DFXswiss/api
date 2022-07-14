import { EntityRepository, Repository, SaveOptions } from 'typeorm';
import { BankTx } from './bank-tx.entity';

@EntityRepository(BankTx)
export class BankTxRepository extends Repository<BankTx> {
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
}
