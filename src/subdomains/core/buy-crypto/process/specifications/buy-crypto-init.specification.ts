import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SmallAmountException } from 'src/shared/exceptions/small-amount.exception';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';

export class BuyCryptoInitSpecification {
  public static isSatisfiedBy(buyCrypto: BuyCrypto): boolean {
    const { cryptoInput } = buyCrypto;

    if (!cryptoInput) return true;

    const { asset, btcAmount, usdtAmount, amount } = cryptoInput;

    switch (asset.blockchain) {
      case Blockchain.DEFICHAIN: {
        if (
          /**
           * @note
           * duplicate check for DFI min amount left here on purpose, constraints in CryptoInputInitSpecification might change
           */
          (asset.dexName === 'DFI' && amount < Config.payIn.minDeposit.DeFiChain.DFI) ||
          (asset.dexName !== 'DFI' && usdtAmount < Config.payIn.minDeposit.DeFiChain.USDT)
        ) {
          this.throw(cryptoInput);
        }

        break;
      }

      case Blockchain.BITCOIN: {
        if (btcAmount < Config.payIn.minDeposit.Bitcoin.BTC) this.throw(cryptoInput);
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

  private static throw(cryptoInput: CryptoInput): never {
    const { asset, amount } = cryptoInput;

    throw new SmallAmountException(
      `Ignoring too small ${asset.blockchain} input for BuyCrypto (${amount} ${asset.dexName}). Pay-in: ${cryptoInput}`,
    );
  }
}
