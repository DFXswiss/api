import { EntityRepository, Repository } from 'typeorm';
import { CryptoInput } from './crypto-input.entity';

@EntityRepository(CryptoInput)
export class CryptoInputRepository extends Repository<CryptoInput> {
  async setNewUpdateTime(cryptoInputId: number): Promise<void> {
    await this.update(cryptoInputId, { updated: new Date() });
  }
}
