import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DataSource } from 'typeorm';
import { AccountType, LedgerAccount } from '../entities/ledger-account.entity';
import { LedgerLeg } from '../entities/ledger-leg.entity';
import { LedgerTx } from '../entities/ledger-tx.entity';
import { LedgerAccountService } from './ledger-account.service';

export interface LedgerLegInput {
  account: LedgerAccount;
  amount: number; // native, signed (Dr = +, Cr = −)
  priceChf?: number;
  amountChf?: number;
  needsMark?: boolean;
}

export interface LedgerTxInput {
  sourceType: string;
  sourceId: string;
  seq: number;
  bookingDate: Date;
  valueDate?: Date;
  description?: string;
  legs: LedgerLegInput[];
  reversalOf?: LedgerTx;
}

const NATIVE_BALANCE_TOLERANCE = 1e-8;
const ROUNDING_ACCOUNT_NAME = 'ROUNDING';

@Injectable()
export class LedgerBookingService {
  private readonly logger = new DfxLogger(LedgerBookingService);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerAccountService: LedgerAccountService,
  ) {}

  /**
   * Books one atomic ledger_tx (§4 header). Computes amountChfCents per leg + amountChfSum, appends a
   * sub-cent ROUNDING leg, enforces the single per-tx invariant amountChfSum = 0 (CHF cross-asset), and
   * writes ledger_tx + ledger_leg atomically. Native balance is NOT a per-tx invariant (§2.3 Major R9-2) —
   * only a sanity-check for pure same-asset transfers.
   */
  async bookTx(input: LedgerTxInput): Promise<LedgerTx> {
    const legs = input.legs.map((leg) => this.prepareLeg(leg));

    await this.appendRoundingLeg(legs);
    this.checkNativeBalance(legs);

    const amountChfSum = legs.reduce((sum, leg) => sum + leg.amountChfCents, 0);

    return this.dataSource.transaction(async (manager) => {
      const tx = manager.create(LedgerTx, {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        seq: input.seq,
        bookingDate: input.bookingDate,
        valueDate: input.valueDate ?? input.bookingDate,
        description: input.description,
        reversalOf: input.reversalOf,
        amountChfSum,
      });
      const savedTx = await manager.save(LedgerTx, tx); // ledger-allowlist

      const entities = legs.map((leg) => manager.create(LedgerLeg, { ...leg, tx: savedTx }));
      await manager.save(LedgerLeg, entities); // ledger-allowlist

      return savedTx;
    });
  }

  /**
   * Reversal/re-book (§4.12, append-only). Reversal-tx with reversalOf = original, inverted legs, next free
   * seq in the (sourceType, sourceId) namespace; the original stays untouched.
   */
  async reverseTx(original: LedgerTx): Promise<LedgerTx> {
    const nextSeq = await this.nextSeq(original.sourceType, original.sourceId);

    return this.bookTx({
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      seq: nextSeq,
      bookingDate: original.bookingDate,
      valueDate: original.valueDate,
      description: original.description,
      reversalOf: original,
      legs: original.legs.map((leg) => ({
        account: leg.account,
        amount: -leg.amount,
        priceChf: leg.priceChf,
        amountChf: leg.amountChf != null ? -leg.amountChf : undefined,
        needsMark: leg.needsMark,
      })),
    });
  }

  // monotonic, collision-free seq allocation in the (sourceType, sourceId) namespace (§4.12)
  async nextSeq(sourceType: string, sourceId: string): Promise<number> {
    const { max } = await this.dataSource
      .getRepository(LedgerTx)
      .createQueryBuilder('tx')
      .select('MAX(tx.seq)', 'max')
      .where('tx.sourceType = :sourceType', { sourceType })
      .andWhere('tx.sourceId = :sourceId', { sourceId })
      .getRawOne<{ max: number | null }>();

    return (max ?? -1) + 1;
  }

  private prepareLeg(leg: LedgerLegInput): LedgerLeg {
    const amount = Util.round(leg.amount, 8); // 8-decimal native display/rounding convention (§2.3)
    const amountChf = leg.amountChf != null ? Util.round(leg.amountChf, 2) : undefined;
    const amountChfCents = Math.round(Util.round(amountChf ?? 0, 2) * 100);

    return Object.assign(new LedgerLeg(), {
      account: leg.account,
      amount,
      priceChf: leg.priceChf ?? null,
      amountChf: amountChf ?? null,
      amountChfCents,
      needsMark: leg.needsMark ?? false,
    });
  }

  // Σ amountChfCents must close to 0; a sub-cent rest is closed by a ROUNDING leg; > tolerance → throw
  private async appendRoundingLeg(legs: LedgerLeg[]): Promise<void> {
    const sum = legs.reduce((acc, leg) => acc + leg.amountChfCents, 0);
    if (sum === 0) return;

    if (Math.abs(sum) > Config.ledger.roundingToleranceCents) {
      throw new Error(
        `Ledger tx CHF imbalance of ${sum} cents exceeds rounding tolerance ${Config.ledger.roundingToleranceCents} (programming error — structural valuation spreads must be plugged before booking)`,
      );
    }

    const roundingAccount = await this.ledgerAccountService.findByName(ROUNDING_ACCOUNT_NAME);
    if (!roundingAccount) throw new Error(`Ledger account ${ROUNDING_ACCOUNT_NAME} not found (CoA bootstrap missing)`);

    legs.push(
      Object.assign(new LedgerLeg(), {
        account: roundingAccount,
        amount: 0,
        priceChf: null,
        amountChf: Util.round(-sum / 100, 2),
        amountChfCents: -sum,
        needsMark: false,
      }),
    );
  }

  /**
   * Native balance is corrected per-asset against the feed (§7), NOT enforced per-tx. The only sanity-check
   * is the class of pure same-asset transfers (all legs ASSET/TRANSIT of the SAME currency): then Σ amount
   * per currency must be 0. A leg on any non-ASSET/TRANSIT account makes the native one-sidedness correct
   * (value-boundary booking) → no native check (§2.3 Major R9-2).
   */
  private checkNativeBalance(legs: LedgerLeg[]): void {
    const onlyAssetTransit = legs.every(
      (leg) => leg.account.type === AccountType.ASSET || leg.account.type === AccountType.TRANSIT,
    );
    if (!onlyAssetTransit) return;

    const byCurrency = Util.groupByAccessor<LedgerLeg, string>(legs, (leg) => leg.account.currency);
    for (const [currency, currencyLegs] of byCurrency.entries()) {
      const nativeSum = currencyLegs.reduce((acc, leg) => acc + leg.amount, 0);
      if (Math.abs(nativeSum) > NATIVE_BALANCE_TOLERANCE) {
        this.logger.error(
          `Ledger same-asset transfer native imbalance for currency ${currency}: ${nativeSum} (programming error)`,
        );
      }
    }
  }
}
