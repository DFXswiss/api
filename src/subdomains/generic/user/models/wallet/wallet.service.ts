import { Injectable } from '@nestjs/common';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { FindOptionsRelations } from 'typeorm';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  private readonly cache = new AsyncCache<Wallet>(CacheItemResetPeriod.EVERY_5_MINUTE);

  constructor(private readonly repo: WalletRepository) {}

  async getWithMasterKey(masterKey: string): Promise<Wallet | undefined> {
    return masterKey && this.cache.get(masterKey, () => this.repo.findOneBy({ masterKey }));
  }

  async getByAddress(address: string): Promise<Wallet | undefined> {
    return this.cache.get(address, () => this.repo.findOneBy({ address }));
  }

  async getByIdOrName(
    id?: number,
    name?: string,
    relations: FindOptionsRelations<Wallet> = {},
  ): Promise<Wallet | undefined> {
    return id || name
      ? this.cache.get(`${id}${name}`, () => this.repo.findOne({ where: [{ id }, { name }], relations }))
      : undefined;
  }

  async getDefault(): Promise<Wallet> {
    return this.cache.get('default', () => this.repo.findOneBy({ id: 1 }));
  }
}
