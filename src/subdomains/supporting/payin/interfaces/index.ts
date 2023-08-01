import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInSendType, PayInStatus } from '../entities/crypto-input.entity';

export interface PayInEntry {
  address: BlockchainAddress;
  txId: string;
  txType: string;
  txSequence?: number;
  blockHeight: number | null;
  amount: number;
  asset: Asset | null;
  btcAmount?: number;
  usdtAmount?: number;
  status?: PayInStatus;
  sendType?: PayInSendType;
}
