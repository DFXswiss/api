import { EntityRepository, Repository } from 'typeorm';
import { FiatOutput } from './fiat-output.entity';

@EntityRepository(FiatOutput)
export class FiatOutputRepository extends Repository<FiatOutput> {
  async setNewUpdateTime(fiatOutputId: number): Promise<void> {
    await this.update(fiatOutputId, { updated: new Date() });
  }
}
