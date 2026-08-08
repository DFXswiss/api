import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { WalletRepository } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { FindOptionsRelations } from 'typeorm';
import { WalletDto } from './dto/wallet.dto';
import { Wallet } from './wallet.entity';

/** Credential / secret columns: audit only that they changed, never previous/next in cleartext. */
const WALLET_SECRET_FIELDS = new Set<keyof WalletDto>(['apiKey']);

@Injectable()
export class WalletService {
  constructor(
    private readonly repo: WalletRepository,
    private readonly logService: LogService,
  ) {}

  async createWallet(dto: WalletDto): Promise<Wallet> {
    const entity = this.repo.create(dto);
    const saved = await this.repo.save(entity);
    this.repo.invalidateCache();
    return saved;
  }

  async updateWallet(id: number, dto: WalletDto): Promise<Wallet> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Wallet not found');

    const changes = this.collectWalletChanges(entity, dto);
    if (Object.keys(changes).length > 0) {
      // Fail-closed: durable audit first; if this throws, the column is not updated.
      await this.logService.create({
        system: 'Wallet',
        subsystem: 'Update',
        severity: LogSeverity.INFO,
        message: JSON.stringify({
          id,
          changes,
        }),
        category: String(id),
        valid: null,
      });
    }

    Object.assign(entity, dto);

    const saved = await this.repo.save(entity);
    this.repo.invalidateCache();
    return saved;
  }

  /**
   * Diff DTO keys that are actually present against the stored entity.
   * Unchanged columns are omitted; empty result means no audit row.
   */
  private collectWalletChanges(
    entity: Wallet,
    dto: WalletDto,
  ): Record<string, { previous: unknown; next: unknown } | { changed: true }> {
    const changes: Record<string, { previous: unknown; next: unknown } | { changed: true }> = {};
    const entityRecord = entity as unknown as Record<string, unknown>;
    const dtoRecord = dto as unknown as Record<string, unknown>;

    for (const key of Object.keys(dtoRecord)) {
      const next = dtoRecord[key];
      if (next === undefined) continue;

      const previous = entityRecord[key];
      if (Object.is(previous, next)) continue;

      if (WALLET_SECRET_FIELDS.has(key as keyof WalletDto)) {
        changes[key] = { changed: true };
      } else {
        changes[key] = { previous: previous ?? null, next };
      }
    }

    return changes;
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
