import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoInput } from '../entities/crypto-input.entity';

export class CryptoInputInitSpecification {
  public static isSatisfiedBy(input: CryptoInput): boolean {
    const { asset, amount } = input;

    // min. deposit
    if (asset) {
      switch (asset.blockchain) {
        case Blockchain.DEFICHAIN: {
          if (asset.dexName === 'DFI' && amount < Config.blockchain.default.minDeposit.DeFiChain.DFI) {
            throw new Error(`Ignoring too small DeFiChain input (${amount} ${asset.dexName})`);
          }

          break;
        }
      }
    }

    return true;
  }
}
