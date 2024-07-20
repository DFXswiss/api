import { Injectable, NotFoundException } from '@nestjs/common';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { FindOptionsRelations } from 'typeorm';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(private readonly repo: WalletRepository) {}

  async createWallet(dto: CreateWalletDto): Promise<Wallet> {
    const entity = this.repo.create(dto);

    return this.repo.save(entity);
  }

  async updateWallet(id: number, dto: UpdateWalletDto): Promise<Wallet> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Wallet not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }

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

  async getKycClients(): Promise<Wallet[]> {
    return this.repo.findCachedBy('kycClients', { isKycClient: true });
  }

  async getDefault(): Promise<Wallet> {
    return this.repo.findOneCachedBy('default', { id: 1 });
  }
}
