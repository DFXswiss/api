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
    // arbitrary wallet. GET /auth/challenge reaches this with no guard, and its own `!wallet`
    // rejection would never fire.
    if (!address) return undefined;

    return this.repo.findOneCachedBy(`address:${address}`, { address });
  }

  async getByIdOrName(
    id?: number,
    name?: string,
    relations: FindOptionsRelations<Wallet> = {},
  ): Promise<Wallet | undefined> {
    if (!id && !name) return undefined;

    // The relations shape is part of the key: without it a caller that needs no relations and one
    // that needs `users` share an entry, and whichever asks first decides what the other gets.
    // Serialised as an array rather than interpolated, so a missing name cannot collide with the
    // literal string 'undefined' — dto.wallet is a free-text field and could carry exactly that.
    const key = `idOrName:${JSON.stringify([id, name, relations])}`;

    return this.repo.findOneCached(key, { where: [{ id }, { name }], relations });
  }

  async getKycClients(): Promise<Wallet[]> {
    return this.repo.findCachedBy('kycClients', { isKycClient: true });
  }

  async getDefault(): Promise<Wallet> {
    return this.repo.findOneCachedBy('default', { id: Config.defaultWalletId });
  }
}
