import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(private readonly walletRepo: WalletRepository) {}

  async getWalletOrDefault(id: number): Promise<Wallet> {
    return (await this.walletRepo.findOneBy({ id })) ?? (await this.walletRepo.findOneBy({ id: 1 }));
  }

  async getAllExternalServices(): Promise<Wallet[]> {
    return this.walletRepo.findBy({ isKycClient: true });
  }

  public getApiKeyInternal(name: string): string {
    return (
      Object.entries(Config.externalKycServices)
        .filter(([key, _]) => key === name)
        .map(([_, value]) => value)[0]?.apiKey ?? undefined
    );
  }
}
