import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BitcoinTestnet4Client } from 'src/integration/blockchain/bitcoin-testnet4/bitcoin-testnet4-client';
import {
  BitcoinTestnet4NodeType,
  BitcoinTestnet4Service,
} from 'src/integration/blockchain/bitcoin-testnet4/bitcoin-testnet4.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutBitcoinTestnet4Service extends PayoutBitcoinBasedService {
  private readonly client: BitcoinTestnet4Client;

  constructor(readonly bitcoinTestnet4Service: BitcoinTestnet4Service) {
    super();

    this.client = bitcoinTestnet4Service.getDefaultClient(BitcoinTestnet4NodeType.BTC_TESTNET4_OUTPUT);
  }

  async isHealthy(): Promise<boolean> {
    try {
      return !!(await this.client?.getInfo());
    } catch {
      return false;
    }
  }

  async sendUtxoToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const feeRate = await this.getCurrentFeeRate();
    return this.client.sendMany(payout, feeRate);
  }

  async getPayoutCompletionData(_context: PayoutOrderContext, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTx(payoutTxId);

    const isComplete = transaction && transaction.blockhash && transaction.confirmations > 0;
    const payoutFee = isComplete ? -(transaction.fee ?? 0) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFeeRate(): Promise<number> {
    const estimatedRate = await this.client?.estimateSmartFee(1);

    // Testnet4 may have low activity, use minimum fee rate if estimation fails
    const baseRate = estimatedRate ?? 1;

    const { minTxAmount } = Config.blockchain.bitcoinTestnet4;
    const multiplier = minTxAmount ? 1.5 : 1;

    return baseRate * multiplier;
  }
}
