import { Network } from 'alchemy-sdk';
import { Environment, GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class AlchemyNetworkMapper {
  private static readonly isPrd = GetConfig().environment === Environment.PRD;

  private static readonly map = new Map<Blockchain, Network>([
    [Blockchain.ETHEREUM, this.isPrd ? Network.ETH_MAINNET : Network.ETH_GOERLI],
    [Blockchain.ARBITRUM, this.isPrd ? Network.ARB_MAINNET : Network.ARB_GOERLI],
    [Blockchain.OPTIMISM, this.isPrd ? Network.OPT_MAINNET : Network.OPT_GOERLI],
    [Blockchain.POLYGON, this.isPrd ? Network.MATIC_MAINNET : Network.MATIC_MUMBAI],
  ]);

  static toAlchemyNetwork(blockchain: Blockchain): Network | undefined {
    return this.map.get(blockchain);
  }
}
