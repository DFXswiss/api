import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { MailType } from '../../notification/enums';
import { NotificationService } from '../../notification/services/notification.service';
import { CheckoutTx } from '../entities/checkout-tx.entity';
import { CheckoutTxRepository } from '../repositories/checkout-tx.repository';

@Injectable()
export class CheckoutTxService {
  constructor(
    private readonly checkoutTxRepo: CheckoutTxRepository,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyService: BuyService,
    private readonly notificationService: NotificationService,
  ) {}

  async createCheckoutBuyCrypto(tx: CheckoutTx): Promise<void> {
    const match = Config.formats.bankUsage.exec(tx.description);

    if (match) {
      const buy = await this.buyService.getByBankUsage(match[0]);
      if (buy) {
        await this.buyCryptoService.createFromCheckoutTx(tx, buy.id);
        return;
      }

      // send internal Mail
      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: {
          subject: 'Checkout Tx Error - BankUsage not found',
          errors: [`CheckoutTx Id: ${tx.id}; Buy Route for bankUsage ${tx.description} not found`],
        },
      });

      return;
    }

    // send internal Mail
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      input: {
        subject: 'Checkout Tx Error - BankUsage not matching format',
        errors: [`CheckoutTx Id: ${tx.id}; Buy Route for bankUsage ${tx.description} not matching`],
      },
    });
  }

  async getCheckoutTx(id: number): Promise<CheckoutTx> {
    const entity = await this.checkoutTxRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Checkout TX not found');

    return entity;
  }
}
