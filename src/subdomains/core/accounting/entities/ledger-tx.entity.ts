import { IEntity } from 'src/shared/models/entity';
import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  RelationId,
  Unique,
  ValueTransformer,
} from 'typeorm';
import { LedgerLeg } from './ledger-leg.entity';

// PostgreSQL bigint → JS number on read, fail LOUD outside the safe-integer range instead of silently rounding (see
// the identical, deliberately colocated transformer in ledger-leg.entity.ts for the full rationale — the two entities
// import each other, so a shared cross-file const would risk an undefined transformer at decorator-eval time).
const chfCentsTransformer: ValueTransformer = {
  to: (value: number): number => value,
  from: (value: string | number | null): number => {
    if (value == null) return value as unknown as number; // NOT NULL column → never hit in practice
    const cents = Number(value);
    if (!Number.isSafeInteger(cents))
      throw new Error(
        `Ledger CHF cents value "${value}" is outside the JS safe-integer range (±${Number.MAX_SAFE_INTEGER}); refusing to silently round`,
      );
    return cents;
  },
};

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

  // integer cents (PostgreSQL bigint — no int4 ceiling; string→number via chfCentsTransformer, see §2-header); always 0 per tx
  @Column({ type: 'bigint', default: 0, transformer: chfCentsTransformer })
  amountChfSum: number;

  @OneToMany(() => LedgerLeg, (leg) => leg.tx)
  legs: LedgerLeg[];
}
