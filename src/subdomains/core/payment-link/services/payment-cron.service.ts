import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentLinkPaymentService } from './payment-link-payment.service';
import { PaymentLinkService } from './payment-link.service';
import { PaymentQuoteService } from './payment-quote.service';

@Injectable()
export class PaymentCronService {
  constructor(
    private readonly paymentLinkService: PaymentLinkService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentActivationService: PaymentActivationService,
    private readonly paymentQuoteService: PaymentQuoteService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAYMENT_EXPIRATION })
  async processExpiredPayments(): Promise<void> {
    await this.paymentLinkPaymentService.processExpiredPayments();
    await this.paymentActivationService.processExpiredActivations();
    await this.paymentQuoteService.processExpiredQuotes();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAYMENT_CONFIRMATIONS })
  async checkTxConfirmations(): Promise<void> {
    await this.paymentLinkPaymentService.checkTxConfirmations();
  }
}
