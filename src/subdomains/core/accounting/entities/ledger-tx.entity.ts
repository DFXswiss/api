import { IEntity } from 'src/shared/models/entity';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, RelationId, Unique } from 'typeorm';
import { LedgerLeg } from './ledger-leg.entity';

// standalone @Entity (no STI) → the CHK lands directly on ledger_tx (§2.2 Minor R1-10)
@Entity()
@Unique(['sourceType', 'sourceId', 'seq']) // idempotency (Issue Z. 62)
@Check(`"amountChfSum" = 0`) // single-row balance gate (CHF cross-asset)
export class LedgerTx extends IEntity {
  @Index()
  @Column({ type: 'timestamp' })
  bookingDate: Date; // settlement-evidence date (§4 per source)

  @Column({ type: 'timestamp' })
  valueDate: Date; // value date (field ?? bookingDate)

  @Column({ length: 512, nullable: true })
  description?: string;

  @Column({ length: 64 })
  sourceType: string; // bank_tx/ExchangeTrade/exchange_tx/payout_order/crypto_input/buy_crypto/…/cutover/manual/mark_to_market

  @Column({ length: 64 })
  sourceId: string; // source-row id as string (trades: order_id; cutover: logId)

  @Column({ type: 'int', default: 0 })
  seq: number; // tx discriminator per (sourceType, sourceId)

  // self-FK for corrections (§4.12); references the original tx
  @Index()
  @ManyToOne(() => LedgerTx, { nullable: true, eager: false })
  @JoinColumn()
  reversalOf?: LedgerTx;

  @RelationId((tx: LedgerTx) => tx.reversalOf)
  reversalOfId?: number;

  // integer cents (PostgreSQL integer, never bigint → JS string, see §2-header); always 0 per tx
  @Column({ type: 'int', default: 0 })
  amountChfSum: number;

  @OneToMany(() => LedgerLeg, (leg) => leg.tx)
  legs: LedgerLeg[];
}
