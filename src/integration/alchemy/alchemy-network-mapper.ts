import { Network } from 'alchemy-sdk';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from '../blockchain/shared/evm/evm.util';

export class AlchemyNetworkMapper {
  private static readonly chainIdToNetworkMap = new Map<number, Network>([
    [1, Network.ETH_MAINNET],
    [5, Network.ETH_GOERLI],
    [11155111, Network.ETH_SEPOLIA],

    [42161, Network.ARB_MAINNET],
    [421613, Network.ARB_GOERLI],
    [421614, Network.ARB_SEPOLIA],

    [10, Network.OPT_MAINNET],
    [420, Network.OPT_GOERLI],
    [11155420, Network.OPT_SEPOLIA],

    [137, Network.MATIC_MAINNET],
    [80001, Network.MATIC_MUMBAI],
    [80002, Network.MATIC_AMOY],

    [8453, Network.BASE_MAINNET],
    [84531, Network.BASE_GOERLI],
    [84532, Network.BASE_SEPOLIA],

    [56, Network.BNB_MAINNET],
    [97, Network.BNB_TESTNET],
  ]);

  static toAlchemyNetworkByChainId(chainId: number): Network | undefined {
    return this.chainIdToNetworkMap.get(chainId);
  }

  static toAlchemyNetworkByBlockchain(blockchain: Blockchain): Network | undefined {
    const chainId = EvmUtil.getChainId(blockchain);
    return this.chainIdToNetworkMap.get(chainId);
  }

  static get availableNetworks(): Blockchain[] {
    return [
      Blockchain.ETHEREUM,
      Blockchain.ARBITRUM,
      Blockchain.OPTIMISM,
      Blockchain.POLYGON,
      Blockchain.BASE,
      Blockchain.BINANCE_SMART_CHAIN,
    ];
  }
}
