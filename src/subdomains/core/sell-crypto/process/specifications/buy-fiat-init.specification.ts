import { Injectable } from '@nestjs/common';
import { PayInIgnoredException } from 'src/shared/payment/exceptions/pay-in-ignored.exception';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { BuyFiat } from '../buy-fiat.entity';

@Injectable()
export class BuyFiatInitSpecification {
  constructor(private readonly transactionHelper: TransactionHelper) {}

  async isSatisfiedBy({ cryptoInput, sell }: BuyFiat): Promise<void> {
    if (!cryptoInput) return;

    const isValid = await this.transactionHelper.isValid(cryptoInput.asset, sell.fiat, cryptoInput.amount);
    if (!isValid)
      throw new PayInIgnoredException(
        `Ignoring invalid ${cryptoInput.asset.blockchain} input for BuyFiat. Pay-in: ${cryptoInput}`,
      );
  }
}
