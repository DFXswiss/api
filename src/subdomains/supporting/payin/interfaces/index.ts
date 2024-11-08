import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInType } from '../entities/crypto-input.entity';

export interface PayInEntry {
  senderAddresses: string;
  receiverAddress: BlockchainAddress;
  txId: string;
  txType: PayInType | null;
  txSequence?: number;
  blockHeight: number | null;
  amount: number;
  asset: Asset | null;
}
