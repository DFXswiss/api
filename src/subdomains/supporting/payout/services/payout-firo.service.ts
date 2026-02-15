import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { FiroClient } from 'src/integration/blockchain/firo/firo-client';
import { FiroFeeService } from 'src/integration/blockchain/firo/services/firo-fee.service';
import { FiroService } from 'src/integration/blockchain/firo/services/firo.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutFiroService extends PayoutBitcoinBasedService {
  private readonly client: FiroClient;

  constructor(
    private readonly firoService: FiroService,
    private readonly feeService: FiroFeeService,
  ) {
    super();

    this.client = firoService.getDefaultClient();
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

  async getPayoutCompletionData(_context: PayoutOrderContext, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTx(payoutTxId);

    const isComplete = transaction && transaction.blockhash && transaction.confirmations > 0;
    const payoutFee = isComplete ? -(transaction.fee ?? 0) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFeeRate(): Promise<number> {
    const baseRate = await this.feeService.getRecommendedFeeRate();

    const { allowUnconfirmedUtxos, cpfpFeeMultiplier, defaultFeeMultiplier } = Config.blockchain.firo;
    const multiplier = allowUnconfirmedUtxos ? cpfpFeeMultiplier : defaultFeeMultiplier;

    return baseRate * multiplier;
  }
}
