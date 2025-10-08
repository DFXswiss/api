import { Injectable, NotFoundException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmBlockchains } from 'src/integration/blockchain/shared/util/blockchain.util';
import { FindOptionsWhere, Like } from 'typeorm';
import { WalletApp } from '../entities/wallet-app.entity';
import { WalletAppRepository } from '../repositories/wallet-app.repository';

@Injectable()
export class WalletAppService {
  constructor(private readonly repo: WalletAppRepository) {}

  async getAllBlockchainWalletApps(blockchain?: Blockchain, active?: boolean): Promise<WalletApp[]> {
    const search: FindOptionsWhere<WalletApp>[] = [
      {
        blockchains: blockchain ? Like(`%${blockchain}%`) : undefined,
        active,
      },
      EvmBlockchains.includes(blockchain) ? { blockchains: Like('%EvmBlockchains%'), active } : undefined,
    ];
    return this.repo.findCachedBy(JSON.stringify(search), search);
  }

  async getRecommendedWalletApps(): Promise<WalletApp[]> {
    return this.repo.findCachedBy('recommended', { recommended: true, active: true });
  }

  async getWalletAppById(id: number): Promise<WalletApp> {
    const wallet = await this.repo.findOneCachedBy(id, { id });
    if (!wallet) throw new NotFoundException('Wallet app not found');
    return wallet;
  }
}
