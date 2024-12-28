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
    if (DisabledProcess(Process.PAYMENT_EXPIRATION)) return;

    await this.paymentLinkPaymentService.processExpiredPayments();
    await this.paymentActivationService.processExpiredActivations();
    await this.paymentQuoteService.processExpiredQuotes();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock()
  async checkTxConfirmations(): Promise<void> {
    if (DisabledProcess(Process.PAYMENT_CONFIRMATIONS)) return;

    await this.paymentLinkPaymentService.checkTxConfirmations();
  }
}
