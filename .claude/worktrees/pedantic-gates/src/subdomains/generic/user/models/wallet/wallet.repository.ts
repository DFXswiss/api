import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletRepository extends CachedRepository<Wallet> {
  constructor(manager: EntityManager) {
    super(Wallet, manager);
  }

  async getByAddress(address: string): Promise<Wallet> {
    return this.findOneBy({ address });
  }
}
