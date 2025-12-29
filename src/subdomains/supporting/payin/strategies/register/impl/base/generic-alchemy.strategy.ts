import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AlchemyStrategy } from './alchemy.strategy';

export class GenericAlchemyStrategy extends AlchemyStrategy {
  protected readonly logger: DfxLogger;
  private readonly _blockchain: Blockchain;

  constructor(blockchain: Blockchain) {
    super();
    this._blockchain = blockchain;
    this.logger = new DfxLogger(`${blockchain}Strategy`);
  }

  get blockchain(): Blockchain {
    return this._blockchain;
  }

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    const walletAddress = this.getWalletAddressForBlockchain();
    return walletAddress ? [walletAddress] : [];
  }

  private getWalletAddressForBlockchain(): string | undefined {
    const walletAddressMap: Partial<Record<Blockchain, string>> = {
      [Blockchain.ETHEREUM]: Config.blockchain.ethereum.ethWalletAddress,
      [Blockchain.SEPOLIA]: Config.blockchain.sepolia.sepoliaWalletAddress,
      [Blockchain.BINANCE_SMART_CHAIN]: Config.blockchain.bsc.bscWalletAddress,
      [Blockchain.ARBITRUM]: Config.blockchain.arbitrum.arbitrumWalletAddress,
      [Blockchain.OPTIMISM]: Config.blockchain.optimism.optimismWalletAddress,
      [Blockchain.POLYGON]: Config.blockchain.polygon.polygonWalletAddress,
      [Blockchain.BASE]: Config.blockchain.base.baseWalletAddress,
      [Blockchain.GNOSIS]: Config.blockchain.gnosis.gnosisWalletAddress,
    };

    return walletAddressMap[this._blockchain];
  }
}
