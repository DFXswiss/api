import { Asset } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from '../../enums/blockchain.enum';

export interface EvmTransaction {
  txId: string;
  amount: number;
  asset: Asset;
  block: number;
  blockchain: Blockchain;
}
