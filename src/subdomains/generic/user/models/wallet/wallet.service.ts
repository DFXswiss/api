import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(private readonly walletRepo: WalletRepository) {}

  async getWalletOrDefault(id: number): Promise<Wallet> {
    return (await this.walletRepo.findOne(id)) ?? (await this.walletRepo.findOne(1));
  }

  async getAllExternalServices(): Promise<Wallet[]> {
    return this.walletRepo.find({ where: { isKycClient: true } });
  }

  public getApiKeyInternal(name: string): string {
    return (
      Object.entries(Config.externalKycServices)
        .filter(([key, _]) => key === name)
        .map(([_, value]) => value)[0]?.apiKey ?? undefined
    );
  }
}
