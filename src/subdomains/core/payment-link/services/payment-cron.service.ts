import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { CustomCronExpression } from 'src/shared/utils/custom-cron-expression';
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

  // The three jobs below split what used to be one decision. Writing and delivering have opposite
  // requirements — a database write, a merchant webhook and a quote cancellation must happen once
  // in the deployment, while the AsyncMap and the device sink in PaymentLinkPaymentService are
  // process-local and only reach a caller connected to the process that fires them. A single scope
  // cannot satisfy both: `Worker` or `Api` leaves callers on every other process unreleased,
  // `Both` repeats every write and every webhook.
  //
  // So the writing runs under the lease (`Worker`), and deliverPaymentUpdates delivers from the
  // persisted state those writes leave behind, in every process, without a lease. It writes
  // nothing and calls nothing outside its process, which is what allows it to run everywhere.

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.PAYMENT_EXPIRATION })
  async processExpiredPayments(): Promise<void> {
    await this.paymentLinkPaymentService.processExpiredPayments();
    await this.paymentActivationService.processExpiredActivations();
    await this.paymentQuoteService.processExpiredQuotes();
  }

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.WORKER, process: Process.PAYMENT_CONFIRMATIONS })
  async checkTxConfirmations(): Promise<void> {
    await this.paymentLinkPaymentService.checkTxConfirmations();
  }

  // Runs at 15 seconds rather than the minute the two jobs above run at, because it is the second
  // hop of a chain: the writing job already costs up to a minute to notice, and this must not add
  // another one to it. It stays cheap at that rate by looking only at what its own process holds —
  // with no caller waiting and no device connected it issues no query at all.
  //
  // `useDelay: false` for the same reason: the jitter exists to spread jobs that do real work per
  // run, and up to five seconds of it would be a third of this interval.
  //
  // Deliberately WITHOUT a `process` flag, and that is a correction. It carried one, and the flag
  // looked like any other job's — but this job is not work, it is the bridge that carries a result
  // from the process that wrote it to the process holding the connection. Switched off in the
  // single-process setup nothing happens, because `doSave` delivers directly there; switched off
  // after the split it silently cuts delivery to everything attached to the OTHER container:
  // waiting callers of `GET /v1/paymentLink/payment/wait` and `GET /v1/lnurlp/wait/:id` hang until
  // they give up, and connected devices are never told their payment went through. No alert sees
  // it — every process still reports its role and a usable lease.
  //
  // A switch whose failure mode is invisible is worse than no switch. The same reasoning already
  // applies to the role heartbeat and to `PaymentLinkGateway.checkConnections`: a mechanism the
  // rest depends on does not get a kill switch. Whatever a switch here would have been used for —
  // load, a misbehaving device — is reached by disabling the jobs that WRITE, which do have flags.
  @DfxCron(CustomCronExpression.EVERY_15_SECONDS, {
    scope: CronScope.BOTH,
    useDelay: false,
  })
  async deliverPaymentUpdates(): Promise<void> {
    await this.paymentLinkPaymentService.deliverPaymentUpdates();
  }

  @DfxCron(CronExpression.EVERY_HOUR, { scope: CronScope.WORKER, process: Process.PAYMENT_FORWARDING })
  async forwardDeposits(): Promise<void> {
    await this.paymentBalanceService.forwardDeposits();
  }
}
