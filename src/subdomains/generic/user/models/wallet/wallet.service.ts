import { Injectable } from '@nestjs/common';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { FindOptionsRelations } from 'typeorm';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(private readonly repo: WalletRepository) {}

  async getByAddress(address: string): Promise<Wallet | undefined> {
    return this.repo.findOneBy({ address });
  }

  async getByIdOrName(
    id?: number,
    name?: string,
    relations: FindOptionsRelations<Wallet> = {},
  ): Promise<Wallet | undefined> {
    return id || name ? this.repo.findOne({ where: [{ id }, { name }], relations }) : undefined;
  }

  async getDefault(): Promise<Wallet> {
    return this.repo.findOneBy({ id: 1 });
  }

  async getAllExternalServices(): Promise<Wallet[]> {
    return this.repo.findBy({ isKycClient: true });
  }
}
