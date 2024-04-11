import { Injectable } from '@nestjs/common';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { FindOptionsRelations } from 'typeorm';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(private readonly repo: WalletRepository) {}

  async getWithMasterKey(masterKey: string): Promise<Wallet | undefined> {
    return masterKey && this.repo.findOneCachedBy(masterKey, { masterKey });
  }

  async getByAddress(address: string): Promise<Wallet | undefined> {
    return this.repo.findOneCachedBy(address, { address });
  }

  async getByIdOrName(
    id?: number,
    name?: string,
    relations: FindOptionsRelations<Wallet> = {},
  ): Promise<Wallet | undefined> {
    return id || name ? this.repo.findOneCached(`${id}${name}`, { where: [{ id }, { name }], relations }) : undefined;
  }

  async getDefault(): Promise<Wallet> {
    return this.repo.findOneCachedBy('default', { id: 1 });
  }
}
