import { Injectable } from '@nestjs/common';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { TransactionSpecificationService } from 'src/shared/payment/services/transaction-specification.service';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';

@Injectable()
export class BuyCryptoInitSpecification {
  constructor(private readonly transactionSpecificationService: TransactionSpecificationService) {}
  async isSatisfiedBy(buyCrypto: BuyCrypto): Promise<boolean> {
    const { cryptoInput, buy } = buyCrypto;

    if (!cryptoInput) return true;

    const { minDeposit } = await this.transactionSpecificationService.get(cryptoInput.asset, buy.asset);

    if (minDeposit.amount * 0.5 > cryptoInput.amount) this.throw(cryptoInput);

    return true;
  }

  private throw(cryptoInput: CryptoInput): never {
    const { asset, amount } = cryptoInput;

    throw new SmallAmountException(
      `Ignoring too small ${asset.blockchain} input for BuyCrypto (${amount} ${asset.dexName}). Pay-in: ${cryptoInput}`,
    );
  }
}
