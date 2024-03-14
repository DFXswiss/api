import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';

export interface PayInEntry {
  address: BlockchainAddress;
  txId: string;
  txType: string;
  txSequence?: number;
  blockHeight: number | null;
  amount: number;
  asset: Asset | null;
}
