import { Repository } from 'typeorm';
import { Util } from '../utils/util';

export abstract class BaseRepository<T> extends Repository<T> {
  async saveMany(entities: T[], transactionSize = 1000, batchSize = 100): Promise<T[]> {
    return Util.doInBatchesAndJoin(entities, (batch) => this.saveBatch(batch, batchSize), transactionSize);
  }

  private async saveBatch(entities: T[], batchSize: number): Promise<T[]> {
    return this.manager.transaction(async (manager) => {
      return Util.doInBatchesAndJoin(entities, (batch) => manager.save(batch), batchSize);
    });
  }
}
