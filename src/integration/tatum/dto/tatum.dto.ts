import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export interface CreateTatumWebhookDto {
  blockchain: Blockchain;
  addresses: string[];
}

export interface TatumWebhookDto {
  address: string;
  amount: string;
  counterAddresses: string[];
  asset: string;
  type: string;
  blockNumber: number;
  txId: string;
  addressesRiskRatio: any[];
  subscriptionId: string;
  subscriptionType: string;
  chain: string;
}
