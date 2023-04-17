import { Injectable } from '@nestjs/common';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';

@Injectable()
export class BuyCryptoInitSpecification {
  constructor(private readonly transactionSpecificationService: TransactionHelper) {}
  async isSatisfiedBy(buyCrypto: BuyCrypto): Promise<boolean> {
    const { cryptoInput, buy } = buyCrypto;

    if (!cryptoInput) return true;

    const { minVolume } = await this.transactionSpecificationService.getSpecs(cryptoInput.asset, buy.asset);

    if (minVolume * 0.5 > cryptoInput.amount) this.throw(cryptoInput);

    return true;
  }

  private throw(cryptoInput: CryptoInput): never {
    const { asset, amount } = cryptoInput;

    throw new SmallAmountException(
      `Ignoring too small ${asset.blockchain} input for BuyCrypto (${amount} ${asset.dexName}). Pay-in: ${cryptoInput}`,
    );
  }
}
