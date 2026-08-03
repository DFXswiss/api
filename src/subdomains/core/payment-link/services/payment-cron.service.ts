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

  // Api, not Worker: this job and checkTxConfirmations both end up in
  // PaymentLinkPaymentService.doSave(), which resolves the AsyncMap that PaymentLinkController's
  // waitForPayment is waiting on and pushes the device activation into the RxJS subject the
  // gateway delivers to its connected clients. Both are confined to the process holding those
  // connections, and the worker holds none. `Both` is no option either: the jobs write to the
  // database and trigger merchant webhooks, which two processes without a shared lock would do
  // twice.
  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.Api, process: Process.PAYMENT_EXPIRATION })
  async processExpiredPayments(): Promise<void> {
    await this.paymentLinkPaymentService.processExpiredPayments();
    await this.paymentActivationService.processExpiredActivations();
    await this.paymentQuoteService.processExpiredQuotes();
  }

  // Api for the same reason as processExpiredPayments above.
  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.Api, process: Process.PAYMENT_CONFIRMATIONS })
  async checkTxConfirmations(): Promise<void> {
    await this.paymentLinkPaymentService.checkTxConfirmations();
  }

  @DfxCron(CronExpression.EVERY_HOUR, { scope: CronScope.Worker, process: Process.PAYMENT_FORWARDING })
  async forwardDeposits(): Promise<void> {
    await this.paymentBalanceService.forwardDeposits();
  }
}
