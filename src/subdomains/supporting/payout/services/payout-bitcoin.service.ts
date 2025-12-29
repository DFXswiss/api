import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinNodeType, BitcoinService } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutBitcoinService extends PayoutBitcoinBasedService {
  private readonly client: BitcoinClient;

  constructor(readonly bitcoinService: BitcoinService, private readonly feeService: BitcoinFeeService) {
    super();

    this.client = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_OUTPUT);
  }

  async isHealthy(): Promise<boolean> {
    try {
      return !!(await this.client.getInfo());
    } catch {
      return false;
    }
  }

  async sendUtxoToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const feeRate = await this.getCurrentFeeRate();
    return this.client.sendMany(payout, feeRate);
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTx(payoutTxId);

    const isComplete = transaction && transaction.blockhash && transaction.confirmations > 0;
    // fee is negative in Bitcoin Core for outgoing transactions, so we negate it
    // Safeguard: if fee is undefined (should not happen for payout txs), default to 0
    const payoutFee = isComplete ? -(transaction.fee ?? 0) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFeeRate(): Promise<number> {
    const baseRate = await this.feeService.getRecommendedFeeRate();

    // Use higher multiplier when unconfirmed UTXOs are enabled (CPFP effect)
    const { allowUnconfirmedUtxos, cpfpFeeMultiplier, defaultFeeMultiplier } = Config.blockchain.default;
    const multiplier = allowUnconfirmedUtxos ? cpfpFeeMultiplier : defaultFeeMultiplier;

    return baseRate * multiplier;
  }
}
