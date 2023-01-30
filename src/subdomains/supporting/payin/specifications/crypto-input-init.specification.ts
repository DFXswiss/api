import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoInput } from '../entities/crypto-input.entity';

export class CryptoInputInitSpecification {
  public static isSatisfiedBy(input: CryptoInput): boolean {
    const { asset, amount, usdtAmount } = input;

    // min. deposit
    if (asset) {
      switch (asset.blockchain) {
        case Blockchain.DEFICHAIN: {
          if (
            (asset.dexName === 'DFI' && amount < Config.blockchain.default.minDeposit.DeFiChain.DFI) ||
            (asset.dexName !== 'DFI' && usdtAmount < Config.blockchain.default.minDeposit.DeFiChain.USD * 0.4)
          ) {
            throw new Error(`Ignoring too small DeFiChain input (${amount} ${asset.dexName})`);
          }

          break;
        }
      }
    }

    return true;
  }
}
