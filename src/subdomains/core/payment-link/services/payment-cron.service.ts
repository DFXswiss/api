import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentLinkPaymentQuoteService } from './payment-link-payment-quote.service';
import { PaymentLinkPaymentService } from './payment-link-payment.service';

@Injectable()
export class PaymentCronService {
  constructor(
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentActivationService: PaymentActivationService,
    private readonly paymentLinkPaymentQuoteService: PaymentLinkPaymentQuoteService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  @Lock()
  async processPendingPayments(): Promise<void> {
    if (DisabledProcess(Process.UPDATE_PAYMENT)) return;

    await this.paymentLinkPaymentService.processPendingPayments();
    await this.paymentActivationService.processPendingActivations();
    await this.paymentLinkPaymentQuoteService.processActualQuotes();
  }
}
