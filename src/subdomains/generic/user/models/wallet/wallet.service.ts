import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { FindOptionsRelations } from 'typeorm';
import { WalletDto } from './dto/wallet.dto';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletService {
  constructor(private readonly repo: WalletRepository) {}

  async createWallet(dto: WalletDto): Promise<Wallet> {
    const entity = this.repo.create(dto);

    return this.repo.save(entity);
  }

  async updateWallet(id: number, dto: WalletDto): Promise<Wallet> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Wallet not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }

  async getByAddress(address: string): Promise<Wallet | undefined> {
    // An undefined address is dropped from the where, leaving an unconditioned lookup that returns an
    // arbitrary wallet and caches it under the key "undefined". GET /auth/challenge reaches this with
    // no guard, and its own `!wallet` rejection would never fire.
    if (!address) return undefined;

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
    return this.repo.findOneCachedBy('default', { id: Config.defaultWalletId });
  }
}
