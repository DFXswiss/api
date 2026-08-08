import { ConflictException, Injectable } from '@nestjs/common';
import {
  FiatRepublicPaymentDirection,
  FiatRepublicPaymentResponse,
  FiatRepublicPaymentStatus,
} from 'src/integration/bank/dto/fiat-republic.dto';
import { FiatRepublicService } from 'src/integration/bank/services/fiat-republic.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { Bank } from '../../../bank/bank/bank.entity';
import { BankService } from '../../../bank/bank/bank.service';
import { IbanBankName } from '../../../bank/bank/dto/bank.dto';
import { VirtualIbanService } from '../../../bank/virtual-iban/virtual-iban.service';
import { SpecialExternalAccount } from '../../../payment/entities/special-external-account.entity';
import { BankTx, BankTxIndicator } from '../entities/bank-tx.entity';

/**
 * Fiat Republic reports epoch timestamps in milliseconds on REST responses but in microseconds on
 * webhook payloads. Anything past this threshold is treated as microseconds.
 */
const MICROSECOND_THRESHOLD = 1e14;
/** Overlap the polling window so a payment that only becomes visible later is not skipped. */
const WATERMARK_OVERLAP_DAYS = 2;

@Injectable()
export class BankTxFiatRepublicService {
  private readonly logger = new DfxLogger(BankTxFiatRepublicService);

  private unavailableWarningLogged = false;

  constructor(
    private readonly fiatRepublicService: FiatRepublicService,
    private readonly bankService: BankService,
    private readonly settingService: SettingService,
    private readonly virtualIbanService: VirtualIbanService,
  ) {}

  /**
   * Polling backstop for the webhook path. Fiat Republic retries a webhook ten times over roughly
   * ninety minutes and then gives up, so a delivery outage longer than that would silently lose
   * payins. This job re-reads the same payments from the API and imports whatever the webhook did
   * not — `accountServiceRef` (the Fiat Republic payment id) makes the two paths idempotent against
   * each other.
   */
  async checkTransactions(
    createTx: (bankTx: Partial<BankTx>, multiAccounts: SpecialExternalAccount[]) => Promise<Partial<BankTx>>,
    multiAccounts: SpecialExternalAccount[],
  ): Promise<void> {
    if (DisabledProcess(Process.BANK_TX_FIAT_REPUBLIC_SYNC)) return;
    if (!this.fiatRepublicService.isBankTxSyncEnabled()) {
      this.warnUnavailableOnce('Fiat Republic bank transaction sync is not enabled - skipping transaction import');
      return;
    }

    const bank = await this.getReceivingBank();
    if (!bank) {
      this.warnUnavailableOnce('No receiving Fiat Republic account configured - skipping transaction import');
      return;
    }

    const settingKey = `lastBankFiatRepublicDate:${bank.id}`;
    const lastModificationTime = new Date(await this.settingService.get(settingKey, new Date(0).toISOString()));
    const now = new Date();

    let payments: FiatRepublicPaymentResponse[];
    try {
      payments = await this.fiatRepublicService.listPayments(lastModificationTime, now);
    } catch (error) {
      this.logger.error('Failed to fetch Fiat Republic payments:', error);
      return;
    }

    const payins = (payments ?? []).filter(
      (payment) =>
        payment.direction === FiatRepublicPaymentDirection.PAYIN &&
        payment.status === FiatRepublicPaymentStatus.COMPLETED,
    );

    let fullyProcessed = true;
    for (const payment of payins) {
      try {
        await createTx(await this.toBankTx(payment, bank), multiAccounts);
      } catch (error) {
        if (error instanceof ConflictException) continue;
        fullyProcessed = false;
        this.logger.error(`Failed to import Fiat Republic payment ${payment.id}:`, error);
      }
    }

    // Same contract as the Bank Frick importer: the cursor only advances after a non-empty window was
    // fully persisted, and always keeps a fixed overlap. SettingService performs a monotonic update,
    // so a stale concurrent worker cannot move it backwards.
    if (fullyProcessed && payments?.length) {
      await this.settingService.setDateMax(settingKey, Util.daysBefore(WATERMARK_OVERLAP_DAYS, now));
    }
  }

  /**
   * Maps a completed Fiat Republic payin onto a bank transaction.
   *
   * Two lookups enrich it beyond what the payment object carries: the virtual account is resolved to
   * the customer's personal IBAN (which is what `BankTxService.assignTransactions` matches on), and
   * the payer is read for the counterparty name and bank details. Both are best-effort — a payin must
   * still be booked when an enrichment call fails, because the money has already arrived.
   */
  async toBankTx(payment: FiatRepublicPaymentResponse, bank?: Bank): Promise<Partial<BankTx>> {
    const account = bank ?? (await this.getReceivingBank());
    if (!account) throw new Error('No receiving Fiat Republic account configured');

    const bookingDate = this.toDate(payment.createdAt);
    const virtualIban = await this.resolveVirtualIban(payment);
    const payer = await this.resolvePayer(payment);

    return {
      accountServiceRef: payment.id,
      bookingDate,
      valueDate: this.toDate(payment.updatedAt) ?? bookingDate,
      amount: +payment.amount,
      currency: payment.currency,
      instructedAmount: +payment.amount,
      instructedCurrency: payment.currency,
      txAmount: +payment.amount,
      txCurrency: payment.currency,
      creditDebitIndicator: BankTxIndicator.CREDIT,
      accountIban: account.iban,
      ...(virtualIban && { virtualIban }),
      ...(payer?.name && { name: payer.name }),
      ...(payer?.bankDetails?.iban && { iban: payer.bankDetails.iban }),
      ...(payer?.bankDetails?.bic && { bic: payer.bankDetails.bic }),
      ...(payer?.bankDetails?.bankName && { bankName: payer.bankDetails.bankName }),
      remittanceInfo: payment.reference,
      txRaw: JSON.stringify(payment),
    };
  }

  // --- HELPER METHODS --- //

  private async getReceivingBank(): Promise<Bank | undefined> {
    const banks = await this.bankService.getBanksByName(IbanBankName.FIAT_REPUBLIC);
    return banks.find((bank) => bank.receive && bank.currency === 'EUR');
  }

  /**
   * Resolves the customer's personal IBAN from the virtual account the payin landed on. The payment
   * object only carries the account id, and it is the IBAN that downstream attribution matches.
   */
  private async resolveVirtualIban(payment: FiatRepublicPaymentResponse): Promise<string | undefined> {
    const target = payment.to;
    if (target?.type !== 'VIRTUAL_ACCOUNT' || !target.id) return undefined;

    try {
      const virtualIban = await this.virtualIbanService.getByProviderAccountRef(target.id);
      return virtualIban?.iban;
    } catch (error) {
      this.logger.error(`Failed to resolve the Fiat Republic virtual account for payment ${payment.id}:`, error);
      return undefined;
    }
  }

  private async resolvePayer(payment: FiatRepublicPaymentResponse) {
    const source = payment.from;
    if (source?.type !== 'PAYER' || !source.id) return undefined;

    try {
      return await this.fiatRepublicService.getPayer(source.id);
    } catch (error) {
      this.logger.error(`Failed to resolve the Fiat Republic payer for payment ${payment.id}:`, error);
      return undefined;
    }
  }

  private toDate(timestamp: number | undefined): Date | undefined {
    if (!Number.isFinite(timestamp)) return undefined;
    return new Date(timestamp > MICROSECOND_THRESHOLD ? Math.floor(timestamp / 1000) : timestamp);
  }

  private warnUnavailableOnce(message: string): void {
    if (this.unavailableWarningLogged) return;
    this.logger.warn(message);
    this.unavailableWarningLogged = true;
  }
}
