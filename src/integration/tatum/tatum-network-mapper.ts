import { Network as TatumNetwork } from '@tatumio/tatum';
import { Blockchain } from '../blockchain/shared/enums/blockchain.enum';

export class TatumNetworkMapper {
  private static readonly blockchainToNetworkMap = new Map<Blockchain, TatumNetwork>([
    [Blockchain.SOLANA, TatumNetwork.SOLANA],
    [Blockchain.TRON, TatumNetwork.TRON],
  ]);

  static toTatumNetworkByBlockchain(blockchain: Blockchain): TatumNetwork | undefined {
    return TatumNetworkMapper.blockchainToNetworkMap.get(blockchain);
  }
}
