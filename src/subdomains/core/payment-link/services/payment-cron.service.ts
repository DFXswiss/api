import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentLinkPaymentService } from './payment-link-payment.service';
import { PaymentQuoteService } from './payment-quote.service';

@Injectable()
export class PaymentCronService {
  constructor(
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentActivationService: PaymentActivationService,
    private readonly paymentQuoteService: PaymentQuoteService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  @Lock()
  async processPendingPayments(): Promise<void> {
    if (DisabledProcess(Process.UPDATE_PAYMENT)) return;

    await this.paymentLinkPaymentService.processPendingPayments();
    await this.paymentActivationService.processPendingActivations();
    await this.paymentQuoteService.processActualQuotes();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock()
  async processQuoteTransactions(): Promise<void> {
    if (DisabledProcess(Process.UPDATE_QUOTE_TRANSACTION)) return;

    await this.paymentQuoteService.processTransactions();
  }
}
