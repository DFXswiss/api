import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { Config } from 'src/config/config';
import { CheckoutPaymentStatus } from 'src/integration/checkout/dto/checkout.dto';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { MailContext, MailType } from '../../notification/enums';
import { NotificationService } from '../../notification/services/notification.service';
import { CheckoutTx } from '../entities/checkout-tx.entity';
import { CheckoutTxRepository } from '../repositories/checkout-tx.repository';

@Injectable()
export class CheckoutTxService {
  constructor(
    private readonly logger: DfxLoggerService,
    private readonly checkoutTxRepo: CheckoutTxRepository,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyService: BuyService,
    private readonly notificationService: NotificationService,
  ) {
    this.logger.create(CheckoutTxService);
  }

  async createCheckoutBuyCrypto(tx: CheckoutTx): Promise<void> {
    const match = Config.formats.bankUsage.exec(tx.description);

    if (match) {
      const buy = await this.buyService.getByBankUsage(match[0]);

      if (buy) {
        await this.buyCryptoService.createFromCheckoutTx(tx, buy);
        return;
      }
    }

    this.logger.error(
      `Invalid Checkout Tx: No buy route found for CheckoutTx with ID ${tx.id} and bankUsage ${tx.description}`,
    );

    // send error mail
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.CHECKOUT_TX,
      input: {
        subject: 'Invalid Checkout Tx',
        errors: [`No buy route found for CheckoutTx with ID ${tx.id} and bankUsage ${tx.description}`],
      },
    });
  }

  async getCheckoutTx(id: number): Promise<CheckoutTx> {
    const entity = await this.checkoutTxRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Checkout TX not found');

    return entity;
  }

  async getPendingRefundedList(): Promise<CheckoutTx[]> {
    return this.checkoutTxRepo.find({ where: { status: CheckoutPaymentStatus.REFUND_PENDING } });
  }

  async paymentRefunded(entityId: number): Promise<void> {
    await this.checkoutTxRepo.update(entityId, {
      status: CheckoutPaymentStatus.REFUND_PENDING,
    });
  }

  async getSyncDate(): Promise<Date> {
    return this.checkoutTxRepo
      .findOne({
        where: { status: CheckoutPaymentStatus.PENDING },
        order: { requestedOn: 'ASC' },
      })
      .then((tx) => tx?.requestedOn ?? Util.minutesBefore(10));
  }
}
