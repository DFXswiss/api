import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { CheckoutPayment, CheckoutPaymentStatus } from 'src/integration/checkout/dto/checkout.dto';
import { CheckoutPaymentAction, CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { ChargebackReason, ChargebackState, TransactionStatus } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { TransactionSourceType } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { CheckoutTx } from '../entities/checkout-tx.entity';
import { CheckoutTxRepository } from '../repositories/checkout-tx.repository';
import { CheckoutTxService } from './checkout-tx.service';

@Injectable()
export class FiatPayInSyncService {
  private static readonly REFUND_RETRY_COOLDOWN_HOURS = 6;
  private static readonly REFUND_MAX_ATTEMPTS = 3;

  private readonly logger = new DfxLogger(FiatPayInSyncService);

  private unavailableWarningLogged = false;

  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly checkoutTxRepo: CheckoutTxRepository,
    private readonly checkoutTxService: CheckoutTxService,
    private readonly transactionService: TransactionService,
    private readonly siftService: SiftService,
    private readonly buyService: BuyService,
  ) {}

  // --- JOBS --- //

  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.Worker, process: Process.FIAT_PAY_IN, timeout: 1800 })
  async syncCheckout() {
    if (!this.checkoutService.isAvailable()) {
      if (!this.unavailableWarningLogged) {
        this.logger.warn('Checkout not configured - skipping syncCheckout');
        this.unavailableWarningLogged = true;
      }
      return;
    }

    const syncDate = await this.checkoutTxService.getSyncDate();
    const payments = await this.checkoutService.getPayments(syncDate);

    for (const payment of payments) {
      try {
        const checkoutTx = await this.createCheckoutTx(payment);

        if (checkoutTx.approved && !checkoutTx.buyCrypto) {
          await this.checkoutTxService.createCheckoutBuyCrypto(checkoutTx);
        } else if (checkoutTx.authStatusReason) {
          const buy = await this.buyService.getByBankUsage(checkoutTx.reference);
          if (buy) this.siftService.checkoutTransaction(checkoutTx, TransactionStatus.FAILURE, buy);
        }
      } catch (e) {
        this.logger.error(`Failed to import checkout transaction:`, e);
      }
    }

    const refundedList = await this.checkoutTxService.getPendingRefundedList();
    await this.retryPendingRefunds(refundedList);
    const refundedPayments = await this.checkoutService.getPaymentList(refundedList);

    for (const refundedPayment of refundedPayments) {
      try {
        const checkoutTx = await this.createCheckoutTx(refundedPayment);
        if (checkoutTx?.status === CheckoutPaymentStatus.REFUNDED) {
          this.siftService.createChargeback({
            $user_id: checkoutTx.transaction.user?.id.toString(),
            $transaction_id: checkoutTx.transaction.id.toString(),
            $order_id: checkoutTx.transaction.request?.id.toString(),
            $chargeback_reason: ChargebackReason.OTHER,
            $chargeback_state: ChargebackState.ACCEPTED,
          });
        }
      } catch (e) {
        this.logger.error(`Failed to import refunded transaction:`, e);
      }
    }
  }

  async createCheckoutTx(payment: CheckoutPayment): Promise<CheckoutTx> {
    const tx = this.mapCheckoutPayment(payment);

    const existing = await this.checkoutTxRepo.findOne({
      where: { paymentId: tx.paymentId },
      select: { id: true },
      loadEagerRelations: false,
    });

    if (!existing) {
      if (!tx.transaction)
        tx.transaction = await this.transactionService.create({ sourceType: TransactionSourceType.CHECKOUT_TX });

      return this.checkoutTxRepo.save(tx);
    }

    return this.checkoutTxRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOne(CheckoutTx, {
        where: { id: existing.id },
        select: { id: true },
        loadEagerRelations: false,
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new Error(`CheckoutTx ${existing.id} disappeared during synchronization`);

      const entity = await manager.findOne(CheckoutTx, {
        where: { id: existing.id },
        relations: { buyCrypto: true, transaction: { request: true, user: true } },
      });
      if (!entity) throw new Error(`CheckoutTx ${existing.id} disappeared during synchronization`);

      const currentStatus = entity.status;
      Object.assign(entity, Util.removeNullFields(tx));
      if (currentStatus === CheckoutPaymentStatus.REFUNDED) entity.status = CheckoutPaymentStatus.REFUNDED;
      else if (
        currentStatus === CheckoutPaymentStatus.PARTIALLY_REFUNDED &&
        tx.status !== CheckoutPaymentStatus.REFUNDED
      )
        entity.status = CheckoutPaymentStatus.PARTIALLY_REFUNDED;
      else if (
        currentStatus === CheckoutPaymentStatus.REFUND_PENDING &&
        ![CheckoutPaymentStatus.PARTIALLY_REFUNDED, CheckoutPaymentStatus.REFUNDED].includes(tx.status)
      )
        entity.status = CheckoutPaymentStatus.REFUND_PENDING;

      if (!entity.transaction)
        entity.transaction = await this.transactionService.create({ sourceType: TransactionSourceType.CHECKOUT_TX });

      return manager.save(CheckoutTx, entity);
    });
  }

  private async retryPendingRefunds(checkoutTxs: CheckoutTx[]): Promise<void> {
    for (const checkoutTx of checkoutTxs) {
      const buyCrypto = checkoutTx.buyCrypto;
      if (!buyCrypto) continue;

      try {
        const actions = await this.checkoutService.getPaymentActions(checkoutTx.paymentId);
        const reference = CheckoutService.buyCryptoRefundReference(buyCrypto.id);
        const amount = Math.round(checkoutTx.amount * 100);
        const matchingRefunds = actions.filter((action) =>
          this.isMatchingRefundAction(action, reference, amount, buyCrypto.chargebackAllowedDate),
        );
        const latestRefund = this.latestRefundAction(matchingRefunds);

        if (latestRefund && latestRefund.approved !== false) {
          if (buyCrypto.chargebackRemittanceInfo !== latestRefund.id)
            await this.persistRefundActionId(buyCrypto, latestRefund.id);
          continue;
        }

        if (latestRefund?.approved === false) {
          if (matchingRefunds.length >= FiatPayInSyncService.REFUND_MAX_ATTEMPTS) {
            this.logger.error(
              `Checkout refund for BuyCrypto ${buyCrypto.id} exhausted ${FiatPayInSyncService.REFUND_MAX_ATTEMPTS} attempts; manual intervention required`,
            );
            continue;
          }

          if (!latestRefund.processed_on) continue;
          const processedOn = new Date(latestRefund.processed_on);
          if (
            Number.isNaN(processedOn.getTime()) ||
            processedOn > Util.hoursBefore(FiatPayInSyncService.REFUND_RETRY_COOLDOWN_HOURS)
          )
            continue;
        }

        const refund = await this.checkoutService.refundBuyCryptoPayment(
          checkoutTx.paymentId,
          buyCrypto.id,
          latestRefund?.id,
        );
        await this.persistRefundActionId(buyCrypto, refund.action_id);
      } catch (e) {
        this.logger.error(`Failed to reconcile Checkout refund for BuyCrypto ${buyCrypto.id}:`, e);
      }
    }
  }

  private latestRefundAction(actions: CheckoutPaymentAction[]): CheckoutPaymentAction | undefined {
    return actions.reduce<CheckoutPaymentAction | undefined>((latest, action) => {
      if (!latest) return action;
      if (!latest.processed_on || !action.processed_on) return latest;
      return new Date(action.processed_on) >= new Date(latest.processed_on) ? action : latest;
    }, undefined);
  }

  private isMatchingRefundAction(
    action: CheckoutPaymentAction,
    reference: string,
    amount: number,
    claimDate?: Date,
  ): boolean {
    if (action.type.toLowerCase() !== 'refund' || action.amount !== amount) return false;
    if (action.reference === reference) return true;

    if (action.reference || !claimDate || !action.processed_on) return false;
    const processedOn = new Date(action.processed_on);
    return !Number.isNaN(processedOn.getTime()) && processedOn >= claimDate;
  }

  private async persistRefundActionId(buyCrypto: BuyCrypto, actionId: string): Promise<void> {
    await this.checkoutTxRepo.manager.update(BuyCrypto, buyCrypto.id, {
      chargebackRemittanceInfo: actionId,
    });
    buyCrypto.chargebackRemittanceInfo = actionId;
  }

  private mapCheckoutPayment(payment: CheckoutPayment): CheckoutTx {
    return this.checkoutTxRepo.create({
      paymentId: payment.id,
      requestedOn: new Date(payment.requested_on),
      expiresOn: payment.expires_on ? new Date(payment.expires_on) : undefined,
      amount: payment.amount / 100,
      currency: payment.currency,
      status: payment.status,
      approved: payment.approved,
      reference: payment.reference,
      description: payment.description,
      type: payment.payment_type,
      cardName: payment.source?.name,
      cardBin: payment.source?.bin,
      cardLast4: payment.source?.last4,
      cardFingerPrint: payment.source?.fingerprint,
      cardIssuer: payment.source?.issuer,
      cardIssuerCountry: payment.source?.issuer_country,
      ip: payment.payment_ip,
      risk: payment.risk?.flagged,
      riskScore: payment.risk?.score,
      authStatusReason: payment['3ds']?.authentication_status_reason,
      raw: JSON.stringify(payment),
    });
  }
}
