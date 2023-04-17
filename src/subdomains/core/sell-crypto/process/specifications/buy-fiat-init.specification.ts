import { Injectable } from '@nestjs/common';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { BuyFiat } from '../buy-fiat.entity';

@Injectable()
export class BuyFiatInitSpecification {
  constructor(private readonly transactionSpecificationService: TransactionHelper) {}

  async isSatisfiedBy(buyFiat: BuyFiat): Promise<boolean> {
    const { cryptoInput, sell } = buyFiat;

    if (!cryptoInput) return true;

    const { minVolume } = await this.transactionSpecificationService.getSpecs(cryptoInput.asset, sell.fiat);

    if (minVolume * 0.5 > cryptoInput.amount) this.throw(cryptoInput);

    return true;
  }

  private throw(cryptoInput: CryptoInput) {
    const { asset, amount } = cryptoInput;

    throw new SmallAmountException(
      `Ignoring too small ${asset.blockchain} input for BuyFiat (${amount} ${asset.dexName}). Pay-in: ${cryptoInput}`,
    );
  }
}
