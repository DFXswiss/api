import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, RelationId } from 'typeorm';
import { chfCentsTransformer } from './ledger-cents.transformer';
import { LedgerAccount } from './ledger-account.entity';
import { LedgerTx } from './ledger-tx.entity';

@Entity()
export class LedgerLeg extends IEntity {
  @Index()
  @ManyToOne(() => LedgerTx, (tx) => tx.legs, { nullable: false })
  @JoinColumn()
  tx: LedgerTx;

  @RelationId((leg: LedgerLeg) => leg.tx)
  txId: number;

  @Index()
  @ManyToOne(() => LedgerAccount, { nullable: false })
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

  // integer cents for checksum (PostgreSQL bigint — no int4 ceiling; string→number via chfCentsTransformer, see §2-header)
  @Column({ type: 'bigint', default: 0, transformer: chfCentsTransformer })
  amountChfCents: number;

  @Index()
  @Column({ default: false })
  needsMark: boolean; // true = no mark available → mark-to-market job candidate
}
