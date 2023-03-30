import { Repository } from 'typeorm';
import { Util } from '../utils/util';

export abstract class BaseRepository<T> extends Repository<T> {
  async saveMany(entities: T[], batchSize = 1000): Promise<T[]> {
    const batches = await Util.doInBatches(entities, (batch) => this.saveBatch(batch), batchSize);
    return batches.reduce((prev, curr) => prev.concat(curr), []);
  }

  private async saveBatch(entities: T[]): Promise<T[]> {
    return this.manager.transaction(async (manager) => {
      const results = [];
      for (const entity of entities) {
        results.push(await manager.save(entity));
      }
      return results;
    });
  }
}
