import { Network } from 'alchemy-sdk';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class AlchemyNetworkMapper {
  private static blockchainConfig = GetConfig().blockchain;

  private static readonly blockchainToChainIdMap = new Map<Blockchain, number>([
    [Blockchain.ETHEREUM, this.blockchainConfig.ethereum.ethChainId],
    [Blockchain.ARBITRUM, this.blockchainConfig.arbitrum.arbitrumChainId],
    [Blockchain.OPTIMISM, this.blockchainConfig.optimism.optimismChainId],
    [Blockchain.POLYGON, this.blockchainConfig.polygon.polygonChainId],
    [Blockchain.BASE, this.blockchainConfig.base.baseChainId],
  ]);

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

    [8453, Network.BASE_MAINNET],
    [84531, Network.BASE_GOERLI],
    [84532, Network.BASE_SEPOLIA],
  ]);

  static getChainId(blockchain: Blockchain): number | undefined {
    return this.blockchainToChainIdMap.get(blockchain);
  }

  static toAlchemyNetworkByChainId(chainId: number): Network | undefined {
    return this.chainIdToNetworkMap.get(chainId);
  }

  static toAlchemyNetworkByBlockchain(blockchain: Blockchain): Network | undefined {
    const chainId = this.blockchainToChainIdMap.get(blockchain);
    return this.chainIdToNetworkMap.get(chainId);
  }
}
