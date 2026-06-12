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

  /**
   * §4.12 reversal/re-book cycle for a content-change on a booked source row. Loads the currently ACTIVE
   * (not-yet-reversed) booking tx for `(sourceType, sourceId)`; if the freshly-computed `legs` differ from its legs
   * beyond the §4.12 float tolerances (amount 1e-8, amountChf 0.005, priceChf 1e-6 — no reversal merely for a mark
   * drift), it runs the verbatim cycle: (1) Reversal-Tx (seq=nextSeq, reversalOf=active, inverted legs); (2)
   * Re-Book-Tx (seq=nextSeq+1, reversalOf=NULL, the corrected legs). The original/active tx stays append-only
   * untouched (§4.12 Z.802/809). A UNIQUE conflict rolls back the one correction tx and surfaces to the caller's
   * try/catch → the content-change watermark is NOT advanced → self-healing retry next run (§4.12 Minor R12-2).
   * Returns true when a correction was booked, false when nothing changed (idempotent re-scan).
   */
  async reverseAndRebookIfChanged(input: LedgerTxInput): Promise<boolean> {
    const active = await this.activeTx(input.sourceType, input.sourceId, input.seq);
    if (!active) return false; // nothing booked yet at this seq → forward booker handles it (no reversal)

    const fresh = input.legs.map((leg) => this.prepareLeg(leg));
    await this.appendRoundingLeg(fresh);
    if (!this.legsDiffer(active.legs, fresh)) return false; // unchanged within §4.12 tolerances → no-op

    // (1) reversal-tx (reversalOf = the active original, inverted legs)
    await this.reverseTx(active);

    // (2) re-book-tx (reversalOf = NULL — a new valid booking) with the corrected legs, next free seq
    const reSeq = await this.nextSeq(input.sourceType, input.sourceId);
    await this.bookTx({ ...input, seq: reSeq, reversalOf: undefined });

    return true;
  }

  /**
   * §4.12 flat reversal: if `(sourceType, sourceId)` has an active booking (forward seq = `originalSeq`) but the
   * source row is no longer bookable (e.g. its type changed to a skipped type), reverse the active tx and do NOT
   * re-book — the corrected state is "nothing booked". Returns true when a reversal was booked, false otherwise.
   */
  async reverseActiveIfBooked(sourceType: string, sourceId: string, originalSeq: number): Promise<boolean> {
    const active = await this.activeTx(sourceType, sourceId, originalSeq);
    if (!active) return false;

    await this.reverseTx(active);
    return true;
  }

  /**
   * The currently active (correction-effective) booking tx that descends from the ORIGINAL forward booking at
   * `originalSeq` (the seq the row was first booked at — e.g. bank_tx seq0, buy_fiat reclassification seq1). Follows
   * the §4.12 reversal chain SPECIFIC to that original (NOT just the highest live seq — a multi-seq source row, e.g.
   * buy_fiat seq1/2/3, has several independent originals and reversing the wrong one would corrupt an unrelated leg).
   *
   * Walk: start at the original (seq=originalSeq, reversalOf NULL). If it is reversed (some reversal's reversalOf
   * points at it), its corrected re-book is the booking (reversalOf NULL) with the SMALLEST seq strictly above the
   * reversal's seq (§4.12 Z.809 order: reversal at seq=N, re-book at seq=N+1); advance to it and repeat. When the
   * current booking is NOT reversed it is the live correction → return it. A flat reversal (reversed, no re-book)
   * returns undefined (= nothing booked now).
   */
  private async activeTx(sourceType: string, sourceId: string, originalSeq: number): Promise<LedgerTx | undefined> {
    const all = await this.dataSource.getRepository(LedgerTx).find({
      where: { sourceType, sourceId },
      relations: { legs: { account: true } },
      order: { seq: 'ASC' },
    });
    if (!all.length) return undefined;

    let current = all.find((tx) => tx.seq === originalSeq && tx.reversalOf == null);
    if (!current) return undefined; // no original forward booking at this seq → nothing to correct (§4.12)

    for (;;) {
      const reversal = all.find((tx) => tx.reversalOfId === current!.id);
      if (!reversal) return current; // current booking is live (not reversed) → the active correction

      // the corrected re-book = first real booking (reversalOf NULL) with seq strictly above the reversal's seq
      const rebook = all
        .filter((tx) => tx.reversalOf == null && tx.seq > reversal.seq)
        .sort((a, b) => a.seq - b.seq)[0];
      if (!rebook) return undefined; // flat reversal (no re-book) → nothing booked now
      current = rebook;
    }
  }

  // §4.12 content-change comparison: legs differ iff the fresh leg multiset cannot be matched 1:1 against the
  // existing one with EVERY field within its float tolerance (amount 1e-8, amountChf 0.005, priceChf 1e-6 — no
  // reversal merely for a sub-tolerance mark drift). Greedy multiset match (legs may repeat the same account, e.g.
  // the buyFiat seq1 reclassification has two `received` legs) — pairwise tolerances, NOT bucketed (boundary-safe).
  private legsDiffer(existing: LedgerLeg[], fresh: LedgerLeg[]): boolean {
    if (existing.length !== fresh.length) return true;

    const within = (a: number | undefined | null, b: number | undefined | null, tol: number): boolean => {
      if (a == null && b == null) return true;
      if (a == null || b == null) return false;
      return Math.abs(a - b) <= tol;
    };
    const matches = (e: LedgerLeg, f: LedgerLeg): boolean =>
      (e.account?.id ?? e.account?.name) === (f.account?.id ?? f.account?.name) &&
      within(e.amount, f.amount, 1e-8) &&
      within(e.amountChf, f.amountChf, 0.005) &&
      within(e.priceChf, f.priceChf, 1e-6);

    const unmatched = [...existing];
    for (const f of fresh) {
      const i = unmatched.findIndex((e) => matches(e, f));
      if (i < 0) return true; // a fresh leg has no tolerance-equal partner → content changed
      unmatched.splice(i, 1);
    }
    return false;
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
