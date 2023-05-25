import { Injectable } from '@nestjs/common';
import { PayInIgnoredException } from 'src/shared/payment/exceptions/pay-in-ignored.exception';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { BuyFiat } from '../buy-fiat.entity';

@Injectable()
export class BuyFiatInitSpecification {
  constructor(private readonly transactionHelper: TransactionHelper) {}

  async isSatisfiedBy({ cryptoInput }: BuyFiat): Promise<void> {
    if (!cryptoInput) return;

    const isValid = await this.transactionHelper.isValidInput(cryptoInput.asset, cryptoInput.amount);
    if (!isValid)
      throw new PayInIgnoredException(
        `Ignoring invalid ${cryptoInput.asset.blockchain} input for buy-fiat. Pay-in: ${cryptoInput}`,
      );
  }
}
