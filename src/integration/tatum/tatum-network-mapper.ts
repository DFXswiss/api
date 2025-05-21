import { Network } from '@tatumio/tatum';
import { Blockchain } from '../blockchain/shared/enums/blockchain.enum';

export class TatumNetworkMapper {
  private static readonly blockchainToNetworkMap = new Map<Blockchain, Network>([
    [Blockchain.ETHEREUM, Network.ETHEREUM],
    [Blockchain.ARBITRUM, Network.ARBITRUM_ONE],
    [Blockchain.OPTIMISM, Network.OPTIMISM],
    [Blockchain.POLYGON, Network.POLYGON],
    [Blockchain.BASE, Network.BASE],
    [Blockchain.BINANCE_SMART_CHAIN, Network.BINANCE_SMART_CHAIN],
    [Blockchain.SOLANA, Network.SOLANA],
  ]);

  static toTatumNetworkByBlockchain(blockchain: Blockchain): Network | undefined {
    return TatumNetworkMapper.blockchainToNetworkMap.get(blockchain);
  }
}
