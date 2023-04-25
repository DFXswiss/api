import { Injectable } from '@nestjs/common';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';

@Injectable()
export class BuyCryptoInitSpecification {
  constructor(private readonly transactionHelper: TransactionHelper) {}

  async isSatisfiedBy(buyCrypto: BuyCrypto): Promise<boolean> {
    const { cryptoInput, target } = buyCrypto;

    if (!cryptoInput) return true;

    const { minVolume } = await this.transactionHelper.getSpecs(cryptoInput.asset, target.asset);

    if (cryptoInput.amount < minVolume * 0.5) this.throw(cryptoInput);

    return true;
  }

  private throw(cryptoInput: CryptoInput): never {
    const { asset, amount } = cryptoInput;

    throw new SmallAmountException(
      `Ignoring too small ${asset.blockchain} input for BuyCrypto (${amount} ${asset.dexName}). Pay-in: ${cryptoInput}`,
    );
  }
}
