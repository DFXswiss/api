import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AccountType, LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerAccountRepository } from '../repositories/ledger-account.repository';

@Injectable()
export class LedgerAccountService {
  constructor(private readonly ledgerAccountRepository: LedgerAccountRepository) {}

  // accounts are resolved character-exact by name (§1.5)
  async findByName(name: string): Promise<LedgerAccount | undefined> {
    return (await this.ledgerAccountRepository.findOneBy({ name })) ?? undefined;
  }

  async findByAssetId(assetId: number): Promise<LedgerAccount | undefined> {
    return (await this.ledgerAccountRepository.findOneBy({ asset: { id: assetId } })) ?? undefined;
  }

  // bootstrap core mechanism (§3): lookup-by-name, create-if-missing. The find→create→save is NOT atomic, so a
  // concurrent first-time create of the same lazily-created account (two consumer crons hitting the same TRANSIT
  // route) makes the loser's save hit the UNIQUE(name) constraint. Catch exactly that (SQLSTATE 23505), reload the
  // row the winner committed and return it → a true idempotent no-op. Any other error propagates unchanged.
  async findOrCreate(
    name: string,
    type: AccountType,
    currency: string,
    assetId?: number,
    active = true,
  ): Promise<LedgerAccount> {
    const existing = await this.findByName(name);
    if (existing) return existing;

    const account = this.ledgerAccountRepository.create({
      name,
      type,
      currency,
      active,
      asset: assetId != null ? ({ id: assetId } as Asset) : undefined,
    });

    try {
      return await this.ledgerAccountRepository.save(account);
    } catch (e) {
      if (!this.isUniqueViolation(e)) throw e; // not the race → surface every other error unchanged

      const created = await this.findByName(name); // the concurrent winner's row
      if (!created) throw e; // 23505 but the row is not findable → not the expected name race; surface the original
      return created;
    }
  }

  // Postgres unique_violation (SQLSTATE 23505): a concurrent caller already committed the account row.
  private isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string })?.code === '23505';
  }
}
