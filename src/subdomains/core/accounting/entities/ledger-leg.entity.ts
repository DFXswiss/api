import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, RelationId } from 'typeorm';
import { LedgerAccount } from './ledger-account.entity';
import { LedgerTx } from './ledger-tx.entity';

@Entity()
export class LedgerLeg extends IEntity {
  @Index()
  @ManyToOne(() => LedgerTx, (tx) => tx.legs, { nullable: false, eager: false })
  @JoinColumn()
  tx: LedgerTx;

  @RelationId((leg: LedgerLeg) => leg.tx)
  txId: number;

  @Index()
  @ManyToOne(() => LedgerAccount, { nullable: false, eager: false })
  @JoinColumn()
  account: LedgerAccount;

  @RelationId((leg: LedgerLeg) => leg.account)
  accountId: number;

  // native, signed (Dr = +, Cr = −); 8-decimal display rounding is a service convention, not DB precision
  @Column({ type: 'float' })
  amount: number;

  @Column({ type: 'float', nullable: true })
  priceChf?: number; // CHF rate at booking (null if native/flag only)

  @Column({ type: 'float', nullable: true })
  amountChf?: number; // Util.round(amount × priceChf, 2) (null if no mark)

  // integer cents for checksum (PostgreSQL integer, never bigint → JS string, see §2-header)
  @Column({ type: 'int', default: 0 })
  amountChfCents: number;

  @Index()
  @Column({ default: false })
  needsMark: boolean; // true = no mark available → mark-to-market job candidate
}
