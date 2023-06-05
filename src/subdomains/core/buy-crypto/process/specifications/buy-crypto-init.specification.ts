import { Injectable } from '@nestjs/common';
import { PayInIgnoredException } from 'src/shared/payment/exceptions/pay-in-ignored.exception';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { BuyCrypto } from '../entities/buy-crypto.entity';

@Injectable()
export class BuyCryptoInitSpecification {
  constructor(private readonly transactionHelper: TransactionHelper) {}

  async isSatisfiedBy({ cryptoInput }: BuyCrypto): Promise<void> {
    if (!cryptoInput) return;

    const isValid = await this.transactionHelper.isValidInput(cryptoInput.asset, cryptoInput.amount);
    if (!isValid)
      throw new PayInIgnoredException(
        `Ignoring invalid ${cryptoInput.asset.blockchain} input for buy-crypto. Pay-in: ${cryptoInput}`,
      );
  }
}
