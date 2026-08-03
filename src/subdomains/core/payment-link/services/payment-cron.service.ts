import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentBalanceService } from './payment-balance.service';
import { PaymentLinkPaymentService } from './payment-link-payment.service';
import { PaymentQuoteService } from './payment-quote.service';

@Injectable()
export class PaymentCronService {
  constructor(
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
    private readonly paymentActivationService: PaymentActivationService,
    private readonly paymentQuoteService: PaymentQuoteService,
    private readonly paymentBalanceService: PaymentBalanceService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.Worker, process: Process.PAYMENT_EXPIRATION })
  async processExpiredPayments(): Promise<void> {
    await this.paymentLinkPaymentService.processExpiredPayments();
    await this.paymentActivationService.processExpiredActivations();
    await this.paymentQuoteService.processExpiredQuotes();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.Worker, process: Process.PAYMENT_CONFIRMATIONS })
  async checkTxConfirmations(): Promise<void> {
    await this.paymentLinkPaymentService.checkTxConfirmations();
  }

  @DfxCron(CronExpression.EVERY_HOUR, { scope: CronScope.Worker, process: Process.PAYMENT_FORWARDING })
  async forwardDeposits(): Promise<void> {
    await this.paymentBalanceService.forwardDeposits();
  }
}
