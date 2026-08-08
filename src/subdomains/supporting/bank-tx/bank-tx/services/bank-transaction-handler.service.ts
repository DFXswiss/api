import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { FiatRepublicPaymentResponse, FiatRepublicPaymentStatus } from 'src/integration/bank/dto/fiat-republic.dto';
import { FiatRepublicWebhookService } from 'src/integration/bank/services/fiat-republic-webhook.service';
import { FiatRepublicService } from 'src/integration/bank/services/fiat-republic.service';
import { YapealWebhookService } from 'src/integration/bank/services/yapeal-webhook.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { BankTx } from '../entities/bank-tx.entity';
import { BankTxFiatRepublicService } from './bank-tx-fiat-republic.service';
import { BankTxService } from './bank-tx.service';

export interface BankTransactionEvent {
  accountIban: string;
  bankTxData: Partial<BankTx>;
}

@Injectable()
export class BankTransactionHandler implements OnModuleInit {
  private readonly logger = new DfxLogger(BankTransactionHandler);

  constructor(
    private readonly yapealWebhookService: YapealWebhookService,
    private readonly fiatRepublicWebhookService: FiatRepublicWebhookService,
    private readonly fiatRepublicService: FiatRepublicService,
    private readonly bankTxFiatRepublicService: BankTxFiatRepublicService,
    private readonly bankTxService: BankTxService,
    private readonly specialAccountService: SpecialExternalAccountService,
  ) {}

  onModuleInit() {
    this.yapealWebhookService.getTransactionObservable().subscribe((event) => this.handleTransaction(event));
    this.fiatRepublicWebhookService
      .getPaymentObservable()
      .subscribe((payment) => void this.handleFiatRepublicPayin(payment));
  }

  private async handleTransaction(event: BankTransactionEvent): Promise<void> {
    const { bankTxData } = event;

    try {
      const multiAccounts = await this.specialAccountService.getMultiAccounts();
      await this.bankTxService.create(bankTxData, multiAccounts);
    } catch (e) {
      if (e instanceof ConflictException) {
        return;
      }

      this.logger.error(
        `Failed to handle bank webhook transaction (transaction ${bankTxData.accountServiceRef} on account ${bankTxData.accountIban}):`,
        e,
      );
    }
  }

  /**
   * Books a Fiat Republic payin the moment its webhook arrives.
   *
   * Only `COMPLETED` is booked. A payment held in `COMPLIANCE_REVIEW` has not credited the master
   * account yet, and Fiat Republic sends a second `PAYMENT.STATUS_UPDATED` once it clears — booking
   * the first one would credit a customer for money that has not arrived. Everything else is left to
   * that later event and, if it never comes, to the polling backstop.
   */
  private async handleFiatRepublicPayin(payment: FiatRepublicPaymentResponse): Promise<void> {
    if (!this.fiatRepublicService.isBankTxSyncEnabled()) return;
    if (payment.status !== FiatRepublicPaymentStatus.COMPLETED) return;

    try {
      const [bankTxData, multiAccounts] = await Promise.all([
        this.bankTxFiatRepublicService.toBankTx(payment),
        this.specialAccountService.getMultiAccounts(),
      ]);
      await this.bankTxService.create(bankTxData, multiAccounts);
    } catch (e) {
      // A duplicate is the normal outcome whenever the polling backstop got there first.
      if (e instanceof ConflictException) return;

      this.logger.error(`Failed to handle Fiat Republic payin webhook (payment ${payment.id}):`, e);
    }
  }
}
