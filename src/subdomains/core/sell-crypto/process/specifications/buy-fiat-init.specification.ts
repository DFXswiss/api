import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { BuyFiat } from '../buy-fiat.entity';

export class BuyFiatInitSpecification {
  public static isSatisfiedBy(buyFiat: BuyFiat): boolean {
    const { cryptoInput } = buyFiat;
    const { asset, btcAmount, usdtAmount } = cryptoInput;

    if (!cryptoInput) return true;

    switch (asset.blockchain) {
      case Blockchain.BITCOIN: {
        if (btcAmount < Config.blockchain.default.minDeposit.Bitcoin.BTC) this.throw(cryptoInput);
        break;
      }

      case Blockchain.ETHEREUM: {
        if (usdtAmount < Config.blockchain.ethereum.minDeposit.USD) this.throw(cryptoInput);
        break;
      }

      case Blockchain.BINANCE_SMART_CHAIN: {
        if (usdtAmount < Config.blockchain.bsc.minDeposit.USD) this.throw(cryptoInput);
        break;
      }

      case Blockchain.ARBITRUM: {
        if (usdtAmount < Config.blockchain.arbitrum.minDeposit.USD) this.throw(cryptoInput);
        break;
      }

      case Blockchain.OPTIMISM: {
        if (usdtAmount < Config.blockchain.optimism.minDeposit.USD) this.throw(cryptoInput);
        break;
      }
    }

    return true;
  }

  private static throw(cryptoInput: CryptoInput) {
    const { asset, amount } = cryptoInput;

    throw new SmallAmountException(
      `Ignoring too small ${asset.blockchain} input for BuyFiat (${amount} ${asset.dexName}). Pay-in: ${cryptoInput}`,
    );
  }
}
