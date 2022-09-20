import { EntityRepository, Repository } from 'typeorm';
import { Wallet } from './wallet.entity';

@EntityRepository(Wallet)
export class WalletRepository extends Repository<Wallet> {
  async getByAddress(address: string, needsRelation = false): Promise<Wallet> {
    return this.findOne({ where: { address } });
  }
}
