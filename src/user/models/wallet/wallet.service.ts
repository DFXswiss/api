import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { WalletRepository } from 'src/user/models/wallet/wallet.repository';
import { IsNull, Not } from 'typeorm';
import { User } from '../user/user.entity';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(private readonly walletRepo: WalletRepository) {}

  async getWalletOrDefault(id: number): Promise<Wallet> {
    return (await this.walletRepo.findOne(id)) ?? (await this.walletRepo.findOne(1));
  }

  async getAllExternalServices(): Promise<Wallet[]> {
    return await this.walletRepo.find({ where: { apiUrl: Not(IsNull()), isKycClient: true } });
  }

  async getAllKycData(walletId: number): Promise<User[]> {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId }, relations: ['users', 'users.userData'] });
    return wallet.users;
  }

  public getApiKeyInternal(name: string): string {
    return (
      Object.entries(Config.externalKycServices)
        .filter(([key, _]) => key === name)
        .map(([_, value]) => value)[0]?.apiKey ?? undefined
    );
  }
}
