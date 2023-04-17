import { Injectable } from '@nestjs/common';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { TransactionSpecificationService } from 'src/shared/payment/services/transaction-specification.service';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { BuyFiat } from '../buy-fiat.entity';

@Injectable()
export class BuyFiatInitSpecification {
  constructor(private readonly transactionSpecificationService: TransactionSpecificationService) {}

  async isSatisfiedBy(buyFiat: BuyFiat): Promise<boolean> {
    const { cryptoInput, sell } = buyFiat;

    if (!cryptoInput) return true;

    const { minDeposit } = await this.transactionSpecificationService.get(cryptoInput.asset, sell.fiat);

    if (minDeposit.amount * 0.5 > cryptoInput.amount) this.throw(cryptoInput);

    return true;
  }

  private throw(cryptoInput: CryptoInput) {
    const { asset, amount } = cryptoInput;

    throw new SmallAmountException(
      `Ignoring too small ${asset.blockchain} input for BuyFiat (${amount} ${asset.dexName}). Pay-in: ${cryptoInput}`,
    );
  }
}
