import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, RelationId, ValueTransformer } from 'typeorm';
import { LedgerAccount } from './ledger-account.entity';
import { LedgerTx } from './ledger-tx.entity';

// PostgreSQL bigint is returned by the driver as a string; map it back to a JS number on read and fail LOUD if a
// value ever leaves the safe-integer range instead of silently rounding (a rounded cent amount would corrupt the
// balance gate). Realistic CHF cent sums stay far below 2^53 (~90'000'000'000'000 CHF), so the guard only fires on
// overflow/corruption — a real error, never a valid amount. Colocated per entity (not a shared import) on purpose:
// ledger-leg and ledger-tx import each other, so a cross-file const would risk an undefined transformer at
// decorator-eval time depending on module load order (matches the repo's inline-transformer precedent).
export const chfCentsTransformer: ValueTransformer = {
  to: (value: number): number => value,
  from: (value: string | number | null): number => {
    if (value == null) return value as unknown as number; // NOT NULL columns → never hit in practice
    const cents = Number(value);
    if (!Number.isSafeInteger(cents))
      throw new Error(
        `Ledger CHF cents value "${value}" is outside the JS safe-integer range (±${Number.MAX_SAFE_INTEGER}); refusing to silently round`,
      );
    return cents;
  },
};

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

  // integer cents for checksum (PostgreSQL bigint — no int4 ceiling; string→number via chfCentsTransformer, see §2-header)
  @Column({ type: 'bigint', default: 0, transformer: chfCentsTransformer })
  amountChfCents: number;

  @Index()
  @Column({ default: false })
  needsMark: boolean; // true = no mark available → mark-to-market job candidate
}
