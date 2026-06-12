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

  // bootstrap core mechanism (§3): lookup-by-name, create-if-missing; re-run no-op on UNIQUE(name)
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

    return this.ledgerAccountRepository.save(account);
  }
}
