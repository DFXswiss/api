import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { CheckoutPayment, CheckoutPaymentStatus } from 'src/integration/checkout/dto/checkout.dto';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { ChargebackReason, ChargebackState, TransactionStatus } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { TransactionSourceType } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { CheckoutTx } from '../entities/checkout-tx.entity';
import { CheckoutTxRepository } from '../repositories/checkout-tx.repository';
import { CheckoutTxService } from './checkout-tx.service';

@Injectable()
export class FiatPayInSyncService {
  constructor(
    private readonly logger: DfxLoggerService,
    private readonly checkoutService: CheckoutService,
    private readonly checkoutTxRepo: CheckoutTxRepository,
    private readonly checkoutTxService: CheckoutTxService,
    private readonly transactionService: TransactionService,
    private readonly siftService: SiftService,
    private readonly buyService: BuyService,
  ) {
    this.logger.create(FiatPayInSyncService);
  }

  // --- JOBS --- //

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.FIAT_PAY_IN, timeout: 1800 })
  async syncCheckout() {
    const syncDate = await this.checkoutTxService.getSyncDate();
    const payments = await this.checkoutService.getPayments(syncDate);

    for (const payment of payments) {
      try {
        const checkoutTx = await this.createCheckoutTx(payment);

        if (checkoutTx.approved && !checkoutTx.buyCrypto) {
          await this.checkoutTxService.createCheckoutBuyCrypto(checkoutTx);
        } else if (checkoutTx.authStatusReason) {
          const buy = await this.buyService.getByBankUsage(checkoutTx.reference);
          if (buy) await this.siftService.checkoutTransaction(checkoutTx, TransactionStatus.FAILURE, buy);
        }
      } catch (e) {
        this.logger.error(`Failed to import checkout transaction:`, e);
      }
    }

    const refundedList = await this.checkoutTxService.getPendingRefundedList();
    const refundedPayments = await this.checkoutService.getPaymentList(refundedList);

    for (const refundedPayment of refundedPayments) {
      try {
        const checkoutTx = await this.createCheckoutTx(refundedPayment);
        if (checkoutTx?.status === CheckoutPaymentStatus.REFUNDED) {
          await this.siftService.createChargeback({
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

    let entity = await this.checkoutTxRepo.findOne({
      where: { paymentId: tx.paymentId },
      relations: { buyCrypto: true, transaction: { request: true, user: true } },
    });
    if (entity) {
      Object.assign(entity, Util.removeNullFields(tx));
    } else {
      entity = tx;
    }

    if (!entity.transaction)
      entity.transaction = await this.transactionService.create({ sourceType: TransactionSourceType.CHECKOUT_TX });

    return this.checkoutTxRepo.save(entity);
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
