import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';

export interface PayInEntry {
  address: BlockchainAddress;
  txId: string;
  blockHeight: number;
  amount: number;
  asset: string;
  assetType: AssetType;
}
