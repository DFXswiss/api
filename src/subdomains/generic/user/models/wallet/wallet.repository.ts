import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletRepository extends BaseRepository<Wallet> {
  constructor(manager: EntityManager) {
    super(Wallet, manager);
  }

  async getByAddress(address: string): Promise<Wallet> {
    return this.findOneBy({ address });
  }
}
