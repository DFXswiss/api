import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, RelationId } from 'typeorm';

export enum AccountType {
  ASSET = 'Asset',
  TRANSIT = 'Transit',
  LIABILITY = 'Liability',
  INCOME = 'Income',
  EXPENSE = 'Expense',
  EQUITY = 'Equity',
  SUSPENSE = 'Suspense',
  ROUNDING = 'Rounding',
}

@Entity()
export class LedgerAccount extends IEntity {
  @Column({ length: 256, unique: true })
  name: string; // deterministic (§3)

  @Index()
  @Column({ length: 32 })
  type: AccountType;

  // only ASSET accounts backed by an asset row; nullable read-only join (no cascade, eager:false)
  @Index()
  @ManyToOne(() => Asset, { nullable: true, eager: false })
  @JoinColumn()
  asset?: Asset;

  @RelationId((account: LedgerAccount) => account.asset)
  assetId?: number;

  @Column({ length: 16 })
  currency: string; // ticker (CHF/EUR/BTC/…)

  @Column({ default: true })
  active: boolean; // false = historical, no new bookings
}
