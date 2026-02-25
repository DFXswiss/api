import { Injectable } from '@nestjs/common';
import { TransactionHistory } from 'src/integration/blockchain/bitcoin/node/bitcoin-based-client';
import { FiroClient } from 'src/integration/blockchain/firo/firo-client';
import { FiroFeeService } from 'src/integration/blockchain/firo/services/firo-fee.service';
import { FiroService } from 'src/integration/blockchain/firo/services/firo.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexFiroService {
  private readonly client: FiroClient;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly feeService: FiroFeeService,
    readonly firoService: FiroService,
  ) {
    this.client = firoService.getDefaultClient();
  }

  async sendUtxoToMany(payout: { addressTo: string; amount: number }[]): Promise<string> {
    const feeRate = await this.getFeeRate();
    return this.client.sendMany(payout, feeRate);
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.client.getBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    const transaction = await this.client.getTx(transferTxId);

    return transaction != null;
  }

  async getRecentHistory(txCount: number): Promise<TransactionHistory[]> {
    return this.client.getRecentHistory(txCount);
  }

  //*** HELPER METHODS ***//

  private async getFeeRate(): Promise<number> {
    return this.feeService.getSendFeeRate();
  }

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: 'FIRO', blockchain: Blockchain.FIRO },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
