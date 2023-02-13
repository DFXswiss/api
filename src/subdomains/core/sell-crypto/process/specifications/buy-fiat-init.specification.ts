import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { BuyFiat } from '../buy-fiat.entity';

export class BuyFiatInitSpecification {
  public static isSatisfiedBy(buyFiat: BuyFiat): boolean {
    const { cryptoInput } = buyFiat;
    const { asset, btcAmount, usdtAmount, amount } = cryptoInput;

    if (!cryptoInput) return true;

    switch (asset.blockchain) {
      case Blockchain.DEFICHAIN: {
        if (
          /**
           * @note
           * duplicate check for DFI min amount left here on purpose, constraints in CryptoInputInitSpecification might change
           */
          (asset.dexName === 'DFI' && amount < Config.blockchain.default.minDeposit.DeFiChain.DFI) ||
          (asset.dexName !== 'DFI' && usdtAmount < Config.blockchain.default.minDeposit.DeFiChain.USDT)
        ) {
          this.throw(cryptoInput);
        }

        break;
      }

      case Blockchain.BITCOIN: {
        if (btcAmount < Config.blockchain.default.minDeposit.Bitcoin.BTC) this.throw(cryptoInput);
        break;
      }

      case Blockchain.ETHEREUM: {
        if (usdtAmount < Config.transaction.minVolume.Ethereum.default.USD) this.throw(cryptoInput);
        break;
      }

      case Blockchain.BINANCE_SMART_CHAIN: {
        if (usdtAmount < Config.transaction.minVolume.BinanceSmartChain.default.USD) this.throw(cryptoInput);
        break;
      }

      case Blockchain.ARBITRUM: {
        if (usdtAmount < Config.transaction.minVolume.Arbitrum.default.USD) this.throw(cryptoInput);
        break;
      }

      case Blockchain.OPTIMISM: {
        if (usdtAmount < Config.transaction.minVolume.Optimism.default.USD) this.throw(cryptoInput);
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
