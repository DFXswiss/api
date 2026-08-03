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
  // waitForPayment awaits and pushes the device activation into the RxJS subject PaymentLinkGateway
  // subscribes to. Both hold their state in the instance, so they only reach a caller of this same
  // process. `Both` is no option either: the jobs write to the database and trigger merchant
  // webhooks, which a second registration would repeat.
  //
  // Those two properties pull against each other, and the scope alone cannot settle it. "Only
  // reaches a caller of this process" argues for running in every API process; "writes and calls
  // out" argues for running in exactly one. DfxCronService leases these jobs, so it is the second:
  // with more than one API process, the one that loses the lease does not release the callers
  // waiting on it, and they wait until their own timeout. That is the recoverable side — a
  // duplicated payout or merchant webhook is not. The lease reports the lost race at error level
  // for exactly this reason; see DfxCronService.guardAcrossProcesses.
  //
  // Resolving it properly means driving the local delivery from persisted state rather than from
  // the job that does the writing, so any process can release its own waiters. That is a change to
  // PaymentLinkPaymentService, not to this scope.
  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.API, process: Process.PAYMENT_EXPIRATION })
  async processExpiredPayments(): Promise<void> {
    await this.paymentLinkPaymentService.processExpiredPayments();
    await this.paymentActivationService.processExpiredActivations();
    await this.paymentQuoteService.processExpiredQuotes();
  }

  // Api for the same reason as processExpiredPayments above.
  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.API, process: Process.PAYMENT_CONFIRMATIONS })
  async checkTxConfirmations(): Promise<void> {
    await this.paymentLinkPaymentService.checkTxConfirmations();
  }

  @DfxCron(CronExpression.EVERY_HOUR, { scope: CronScope.WORKER, process: Process.PAYMENT_FORWARDING })
  async forwardDeposits(): Promise<void> {
    await this.paymentBalanceService.forwardDeposits();
  }
}
