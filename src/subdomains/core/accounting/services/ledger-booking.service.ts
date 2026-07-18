import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DataSource, EntityManager } from 'typeorm';
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

// §4.12 "eigener seq-Namespace" (D15 C.b line 72): reversal/re-book tx live in the SAME (sourceType, sourceId) but in
// a seq RANGE reserved ABOVE every forward fixed seq (the highest forward seq is buy_fiat seq3). Without this, a
// reversal of an EARLY forward seq before the LATER forward seqs are booked (e.g. buy_fiat seq1 content-change before
// transmit/booked) would take MAX(seq)+1 = the index of a not-yet-booked forward seq → the later forward booking then
// hits a UNIQUE collision (Major R3, multi-seq sources). Anchoring corrections at this base keeps them monotonic and
// collision-free with the forward seqs while staying in the same namespace.
const CORRECTION_SEQ_BASE = 1_000_000;

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
    return this.dataSource.transaction((manager) => this.bookTxWithManager(manager, input));
  }

  // core booking body, transaction-scoped: all reads/writes go through `manager` so the caller controls atomicity
  // (§4.12: reversal + re-book must live in ONE transaction). Behaviour is identical to the public bookTx.
  private async bookTxWithManager(manager: EntityManager, input: LedgerTxInput): Promise<LedgerTx> {
    const legs = input.legs.map((leg) => this.prepareLeg(leg));

    await this.appendRoundingLeg(legs);
    this.checkNativeBalance(legs, input);

    const amountChfSum = legs.reduce((sum, leg) => sum + leg.amountChfCents, 0);

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
  }

  /**
   * Reversal/re-book (§4.12, append-only). Reversal-tx with reversalOf = original, inverted legs, next free
   * seq in the (sourceType, sourceId) namespace; the original stays untouched.
   */
  async reverseTx(original: LedgerTx): Promise<LedgerTx> {
    return this.dataSource.transaction((manager) => this.reverseTxWithManager(manager, original));
  }

  // transaction-scoped reversal: the correction seq is allocated via the SAME `manager` so it sees any uncommitted
  // sibling booking in the caller's transaction (§4.12 one-transaction reversal + re-book).
  private async reverseTxWithManager(manager: EntityManager, original: LedgerTx): Promise<LedgerTx> {
    const nextSeq = await this.nextCorrectionSeqWithManager(manager, original.sourceType, original.sourceId);

    return this.bookTxWithManager(manager, {
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

    // §4.12: reversal + re-book in ONE transaction so a crash between them cannot leave a flat-reversal state (the
    // next run would then collide on the original forward seq — a UNIQUE loop). The re-book seq is allocated via the
    // SAME `manager` so it sees the uncommitted reversal → reversal.seq + 1, collision-free inside the transaction.
    await this.dataSource.transaction(async (manager) => {
      // (1) reversal-tx (reversalOf = the active original, inverted legs)
      await this.reverseTxWithManager(manager, active);

      // (2) re-book-tx (reversalOf = NULL — a new valid booking) with the corrected legs, next free CORRECTION seq
      // (above the forward range, so it never collides with a not-yet-booked forward seq of a multi-seq source, R3)
      const reSeq = await this.nextCorrectionSeqWithManager(manager, input.sourceType, input.sourceId);
      await this.bookTxWithManager(manager, { ...input, seq: reSeq, reversalOf: undefined });
    });

    return true;
  }

  /**
   * §4.12 value-coupled chain reversal (Major M3). Several forward seqs of one source row can share a value (buy_fiat
   * reclassification seq1 / transmit seq2 / settlement seq3 all carry owedChf; buy_crypto Card input seq0 / completion
   * seq1 both carry the amountInChf base). A content-change that reverses+rebooks ONLY the first seq leaves the later,
   * already-booked seqs on the OLD value → the shared liability (owed/received) never closes to 0 (liability closure
   * breaks). This reverses the WHOLE currently-active chain and re-books every input atomically, but ONLY when at least
   * one input differs from its active booking (idempotent re-scan otherwise). `inputs` are the value-coupled seqs in
   * ascending seq order; each participates only if it currently has an active booking (a later seq not yet settled has
   * none → left to the forward path, which books it fresh at the new value). Each (reversal, re-book) pair is written
   * adjacently — the re-book lands at reversal.seq+1 because its correction seq is allocated AFTER its own reversal via
   * the same `manager` — so the §4.12 activeTx adjacency walk still resolves every corrected seq. Returns true when a
   * correction was booked.
   */
  async reverseAndRebookChainIfChanged(inputs: LedgerTxInput[]): Promise<boolean> {
    const active = await Promise.all(inputs.map((i) => this.activeTx(i.sourceType, i.sourceId, i.seq)));
    const chain = inputs
      .map((input, i) => ({ input, original: active[i] }))
      .filter((p): p is { input: LedgerTxInput; original: LedgerTx } => p.original != null);
    if (!chain.length) return false; // nothing active yet → the forward booker owns these seqs

    const changed = await Promise.all(
      chain.map(async ({ input, original }) => {
        const fresh = input.legs.map((leg) => this.prepareLeg(leg));
        await this.appendRoundingLeg(fresh);
        return this.legsDiffer(original.legs, fresh);
      }),
    );
    if (!changed.some(Boolean)) return false; // every active seq within §4.12 tolerances → no-op

    // reverse + re-book the whole chain in ONE transaction; the re-book of each seq is allocated AFTER its own reversal
    // (through `manager`) → it lands at reversal.seq+1, keeping the activeTx adjacency walk intact for every seq.
    await this.dataSource.transaction(async (manager) => {
      for (const { input, original } of chain) {
        await this.reverseTxWithManager(manager, original);
        const reSeq = await this.nextCorrectionSeqWithManager(manager, input.sourceType, input.sourceId);
        await this.bookTxWithManager(manager, { ...input, seq: reSeq, reversalOf: undefined });
      }
    });

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
   * True iff `(sourceType, sourceId)` has an ACTIVE (not-yet-reversed-without-rebook) booking whose forward original
   * sits at `originalSeq`. The multi-seq consumers (buy_fiat seq1/2/3, buy_crypto seq0/1) MUST gate per-seq on THIS,
   * not on `nextSeq(...) > seq`: after a §4.12 content-change reversal of an earlier seq (reversal seq=N, re-book
   * seq=N+1), `MAX(seq)` jumps past the later seqs' indices so `nextSeq > laterSeq` reads true even though those later
   * seqs were never booked → they would be skipped forever and their liabilities never close (Class-1 break, R3).
   */
  async hasActiveTxAt(sourceType: string, sourceId: string, originalSeq: number): Promise<boolean> {
    return (await this.activeTx(sourceType, sourceId, originalSeq)) != null;
  }

  /**
   * True iff ANY tx has EVER been booked at this exact `(sourceType, sourceId, seq)` — active, reversed, OR a
   * reversal/re-book. The content-change scan uses it to decide whether a status-filtered row it re-selected (by the
   * `updated` cursor, not the id-watermark) was ever forward-booked: a late-settling row the id-watermark skipped has
   * NONE, so it is booked forward (C1); a flat-reversed original DOES have one, so the forward book is skipped (an
   * append-only bookTx at the original seq would collide on the UNIQUE constraint). Unlike hasActiveTxAt this does not
   * walk the reversal chain — mere existence at the seq is the signal.
   */
  async hasAnyTxAt(sourceType: string, sourceId: string, seq: number): Promise<boolean> {
    return this.dataSource.getRepository(LedgerTx).existsBy({ sourceType, sourceId, seq });
  }

  /**
   * The currently active (correction-effective) booking tx that descends from the ORIGINAL forward booking at
   * `originalSeq` (the seq the row was first booked at — e.g. bank_tx seq0, buy_fiat reclassification seq1). Follows
   * the §4.12 reversal chain SPECIFIC to that original (NOT just the highest live seq — a multi-seq source row, e.g.
   * buy_fiat seq1/2/3, has several independent originals and reversing the wrong one would corrupt an unrelated leg).
   *
   * Walk: start at the original (seq=originalSeq, reversalOfId NULL). If it is reversed (some reversal's reversalOfId
   * points at it), its corrected re-book is the booking (reversalOfId NULL) at EXACTLY reversal.seq + 1 (§4.12 Z.809
   * order: reversal at seq=N, re-book at seq=N+1); advance to it and repeat. Requiring adjacency (not merely "smallest
   * seq above") makes a flat reversal (reversed, no re-book) — whose N+1 slot is empty — resolve to undefined instead
   * of grabbing an unrelated correction tx across the seq gap. When the current booking is NOT reversed it is the live
   * correction → return it.
   */
  private async activeTx(sourceType: string, sourceId: string, originalSeq: number): Promise<LedgerTx | undefined> {
    const all = await this.dataSource.getRepository(LedgerTx).find({
      where: { sourceType, sourceId },
      relations: { legs: { account: true } },
      order: { seq: 'ASC' },
    });
    if (!all.length) return undefined;

    let current = all.find((tx) => tx.seq === originalSeq && tx.reversalOfId == null);
    if (!current) return undefined; // no original forward booking at this seq → nothing to correct (§4.12)

    for (;;) {
      const reversal = all.find((tx) => tx.reversalOfId === current!.id);
      if (!reversal) return current; // current booking is live (not reversed) → the active correction

      // the corrected re-book = the real booking (reversalOf NULL) at EXACTLY reversal.seq + 1 (§4.12 Z.809 order:
      // reversal at seq=N, re-book at seq=N+1). Requiring adjacency avoids grabbing a FOREIGN correction tx across a
      // seq gap left by a flat reversal (no re-book) — that gap must resolve to "nothing booked", not the next tx.
      const rebook = all.find((tx) => tx.reversalOfId == null && tx.seq === reversal.seq + 1);
      if (!rebook) return undefined; // flat reversal (no adjacent re-book) → nothing booked now
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

  // monotonic, collision-free seq allocation in the (sourceType, sourceId) namespace (§4.12) — reads the committed
  // state via the DataSource's own connection
  async nextSeq(sourceType: string, sourceId: string): Promise<number> {
    return this.nextSeqFrom(this.dataSource, sourceType, sourceId);
  }

  // monotonic, collision-free seq for a reversal/re-book tx — ALWAYS in the reserved correction range (§4.12 "eigener
  // seq-Namespace"), so it never lands on a forward fixed seq (0–3) of a multi-seq source that is not yet booked (R3).
  async nextCorrectionSeq(sourceType: string, sourceId: string): Promise<number> {
    return Math.max(await this.nextSeq(sourceType, sourceId), CORRECTION_SEQ_BASE);
  }

  // manager-scoped correction seq: reads through the transaction `manager` so it sees an uncommitted sibling booking
  // (the reversal just written in the same §4.12 transaction) → reversal.seq + 1, collision-free.
  private async nextCorrectionSeqWithManager(
    manager: EntityManager,
    sourceType: string,
    sourceId: string,
  ): Promise<number> {
    return Math.max(await this.nextSeqFrom(manager, sourceType, sourceId), CORRECTION_SEQ_BASE);
  }

  // `runner` is the DataSource (its own connection, committed state) or the transaction EntityManager (sees the
  // uncommitted sibling booking) — an explicit choice by the caller, NOT a silent fallback. Both expose
  // getRepository(...).createQueryBuilder(...) with the same shape.
  private async nextSeqFrom(runner: DataSource | EntityManager, sourceType: string, sourceId: string): Promise<number> {
    const { max } = await runner
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

    // A non-finite amount would surface only as an opaque Postgres bigint/double error (prod incident:
    // `invalid input syntax for type bigint: "NaN"`); fail loud here with the account context instead.
    if (
      !Number.isFinite(amount) ||
      !Number.isSafeInteger(amountChfCents) ||
      (leg.priceChf != null && !Number.isFinite(leg.priceChf))
    ) {
      throw new Error(
        `Ledger leg for account ${leg.account?.name} is not finite (amount ${leg.amount}, priceChf ${leg.priceChf}, amountChf ${leg.amountChf}) — refusing to book`,
      );
    }

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
   * is the class of pure same-asset transfers (all legs ASSET/TRANSIT of ONE currency): then Σ amount must be
   * 0. Two things put a tx outside that scope → no native check (§2.3 Major R9-2): a leg on any non-ASSET/TRANSIT
   * account (value-boundary booking → native one-sidedness is correct), OR a second currency — a cross-asset
   * trade, whose per-currency native delta is the traded amount and thus never 0 (that is the point of the trade).
   *
   * The residual is judged in CHF at the group mark, not natively (§7 unit-fix): a bare native tolerance flags
   * sub-rappen fiat rounding (a fiat bank leg carries the unrounded output at >2 dp) yet is ~52'000× too loose
   * for BTC. An unvalued tx (no mark) falls back to the raw native tolerance so a real imbalance is never
   * silently passed.
   */
  private checkNativeBalance(legs: LedgerLeg[], input: LedgerTxInput): void {
    const onlyAssetTransit = legs.every(
      (leg) => leg.account.type === AccountType.ASSET || leg.account.type === AccountType.TRANSIT,
    );
    if (!onlyAssetTransit) return;

    const byCurrency = Util.groupByAccessor<LedgerLeg, string>(legs, (leg) => leg.account.currency);
    if (byCurrency.size !== 1) return; // cross-asset trade: per-currency native delta is the trade, not an imbalance

    const [currency, currencyLegs] = [...byCurrency.entries()][0];
    const nativeSum = currencyLegs.reduce((acc, leg) => acc + leg.amount, 0);
    if (Math.abs(nativeSum) <= NATIVE_BALANCE_TOLERANCE) return; // conserves natively

    const mark = Math.max(...currencyLegs.map((leg) => Math.abs(leg.priceChf ?? 0)));
    const imbalanceChf = Util.round(Math.abs(nativeSum) * mark, 2);
    if (mark > 0 && imbalanceChf <= Config.ledger.roundingToleranceCents / 100) return; // sub-cent rounding noise

    const accounts = currencyLegs.map((leg) => `${leg.account.name} ${leg.amount}`).join(', ');
    this.logger.error(
      `Ledger same-asset transfer native imbalance for currency ${currency}: ${nativeSum} (${imbalanceChf} CHF ` +
        `@ mark ${mark}; source ${input.sourceType} ${input.sourceId} seq ${input.seq}; legs: ${accounts}) (programming error)`,
    );
  }
}
