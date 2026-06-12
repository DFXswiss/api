import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { CryptoInput, CryptoInputSettledStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { In, MoreThan, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { getLedgerWatermark, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'crypto_input';
const CHF = 'CHF';

/**
 * The EINZIGE booker of the crypto-input leg (Single-Booker §4.1 Blocker R1-1) + the standalone forward-fee
 * booker (§4.4). Pure observer: reads crypto_input (+ buyFiat/buyCrypto for the amountInChf base anchor),
 * writes only ledger_*.
 *
 * seq0 (buyFiat/buyCrypto-swap): 3-leg with an amountInChf-anchored received-Cr leg + fx-revaluation plug
 * (§4.4a Blocker R7-1) — so the later completion clear closes `received` cent-exact. isPayment (paymentLink):
 * 2-leg, mark-based (no per-input amountInChf anchor, @ManyToOne, Minor R10-4). seq1: forward fee only.
 */
@Injectable()
export class CryptoInputConsumer {
  private readonly logger = new DfxLogger(CryptoInputConsumer);

  constructor(
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    @InjectRepository(CryptoInput) private readonly cryptoInputRepo: Repository<CryptoInput>,
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    // settled-status filter (§4.4 — NOT isConfirmed, Major R2-3); txType=PAYMENT is included via status
    const batch = await this.cryptoInputRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId), status: In(CryptoInputSettledStatus) },
      relations: { buyFiat: true, buyCrypto: true },
      order: { id: 'ASC' },
      take: Config.ledger.backfillBatchSize,
    });
    if (!batch.length) return;

    const times = batch.map((ci) => ci.updated.getTime());
    const marks = await this.markService.preload(new Date(Math.min(...times)), new Date(Math.max(...times)));

    let lastProcessedId = watermark.lastProcessedId;
    for (const ci of batch) {
      try {
        await this.book(ci, marks);
        lastProcessedId = ci.id;
      } catch (e) {
        this.logger.error(`Failed to book crypto_input ${ci.id}`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  private async book(ci: CryptoInput, marks: LedgerMarkCache): Promise<void> {
    const bookingDate = ci.updated;

    await this.bookInput(ci, bookingDate, marks); // seq0
    await this.bookForwardFee(ci, bookingDate); // seq1 (only if outTxId + forwardFeeAmountChf)
  }

  // seq0 — the crypto-input leg (§4.4/§4.4a)
  private async bookInput(ci: CryptoInput, bookingDate: Date, marks: LedgerMarkCache): Promise<void> {
    if (await this.alreadyBooked(ci.id, 0)) return; // idempotent: don't re-open after a re-run

    const wallet = await this.walletAsset(ci);
    const mark = wallet.assetId != null ? marks.getMarkAt(wallet.assetId, bookingDate) : undefined;
    const assetChf = mark != null ? Util.round(mark * ci.amount, 2) : undefined;

    const assetLeg: LedgerLegInput = {
      account: wallet,
      amount: +ci.amount,
      priceChf: mark ?? null,
      amountChf: assetChf,
      needsMark: assetChf == null,
    };

    if (ci.isPayment) {
      // paymentLink: 2-leg, mark-based (no per-input amountInChf anchor — @ManyToOne, Minor R10-4)
      const paymentLink = await this.liability('paymentLink');
      await this.bookingService.bookTx({
        sourceType: SOURCE_TYPE,
        sourceId: `${ci.id}`,
        seq: 0,
        bookingDate,
        valueDate: bookingDate,
        legs: [
          assetLeg,
          {
            account: paymentLink,
            amount: -(assetChf ?? 0),
            priceChf: 1,
            amountChf: assetChf != null ? -assetChf : undefined,
            needsMark: assetChf == null,
          },
        ],
      });
      return;
    }

    // buyFiat / buyCrypto-swap: 3-leg, amountInChf-anchored received-Cr leg + fx-revaluation plug (§4.4a)
    const product = this.productAnchor(ci);
    if (!product) {
      this.logger.error(`crypto_input ${ci.id} has neither buyFiat/buyCrypto nor isPayment — skip seq0`);
      return;
    }

    const received = await this.liability(`${product.bucket}-received`);
    const legs: LedgerLegInput[] = [
      assetLeg,
      { account: received, amount: -product.amountInChf, priceChf: 1, amountChf: -product.amountInChf },
    ];
    this.appendFxPlug(legs, await this.fxAccounts());

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${ci.id}`,
      seq: 0,
      bookingDate,
      valueDate: bookingDate,
      legs,
    });
  }

  // seq1 — standalone forward fee (§4.4): Dr EXPENSE/network-fee / Cr ASSET/{asset.uniqueName}.
  // The fee's priceChf is derived from the persisted forwardFeeAmountChf/forwardFeeAmount pair, not the cache.
  private async bookForwardFee(ci: CryptoInput, bookingDate: Date): Promise<void> {
    if (!ci.outTxId || ci.forwardFeeAmountChf == null) return; // null fee → no leg (Null-Strategie §5.1)
    if (await this.alreadyBooked(ci.id, 1)) return;

    const wallet = await this.walletAsset(ci);
    const feeChf = ci.forwardFeeAmountChf;
    const feeNative = ci.forwardFeeAmount;
    const mark = feeChf != null && feeNative ? Util.round(feeChf / feeNative, 8) : null;
    const networkFee = await this.expense('network-fee');

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${ci.id}`,
      seq: 1,
      bookingDate,
      valueDate: bookingDate,
      legs: [
        { account: networkFee, amount: feeChf, priceChf: 1, amountChf: feeChf },
        { account: wallet, amount: -(feeNative ?? feeChf), priceChf: mark, amountChf: -feeChf },
      ],
    });
  }

  // --- HELPERS --- //

  // appends an EXPENSE/INCOME fx-revaluation plug for the seq0 valuation residual amountInChf − mark×amount (§4.4a);
  // sub-cent → the booking-service ROUNDING leg closes it
  private appendFxPlug(legs: LedgerLegInput[], fx: { income: LedgerAccount; expense: LedgerAccount }): void {
    const sumCents = legs.reduce((s, l) => s + Math.round(Util.round(l.amountChf ?? 0, 2) * 100), 0);
    if (Math.abs(sumCents) <= Config.ledger.roundingToleranceCents) return;

    const residualChf = Util.round(-sumCents / 100, 2);
    const account = residualChf >= 0 ? fx.income : fx.expense;
    legs.push({ account, amount: residualChf, priceChf: 1, amountChf: residualChf });
  }

  private productAnchor(ci: CryptoInput): { bucket: string; amountInChf: number } | undefined {
    if (ci.buyFiat?.amountInChf != null) return { bucket: 'buyFiat', amountInChf: ci.buyFiat.amountInChf };
    if (ci.buyCrypto?.amountInChf != null) return { bucket: 'buyCrypto', amountInChf: ci.buyCrypto.amountInChf };
    return undefined;
  }

  private async alreadyBooked(id: number, seq: number): Promise<boolean> {
    return (await this.bookingService.nextSeq(SOURCE_TYPE, `${id}`)) > seq;
  }

  private async walletAsset(ci: CryptoInput): Promise<LedgerAccount> {
    if (!ci.asset) throw new Error(`crypto_input ${ci.id} has no asset`);
    const account = await this.accountService.findByAssetId(ci.asset.id);
    if (!account) throw new Error(`ledger account for asset ${ci.asset.id} not found (CoA bootstrap missing)`);
    return account;
  }

  private liability(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`LIABILITY/${qualifier}`, AccountType.LIABILITY, CHF);
  }

  private expense(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`EXPENSE/${qualifier}`, AccountType.EXPENSE, CHF);
  }

  private async fxAccounts(): Promise<{ income: LedgerAccount; expense: LedgerAccount }> {
    return {
      income: await this.accountService.findOrCreate('INCOME/fx-revaluation', AccountType.INCOME, CHF),
      expense: await this.accountService.findOrCreate('EXPENSE/fx-revaluation', AccountType.EXPENSE, CHF),
    };
  }
}
