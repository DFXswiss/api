import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BtcClient, TransactionHistory } from 'src/integration/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { BtcFeeService } from 'src/integration/blockchain/ain/services/btc-fee.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexBitcoinService {
  #client: BtcClient;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly feeService: BtcFeeService,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.BTC_OUTPUT).subscribe((client) => (this.#client = client));
  }

  async sendUtxoToMany(payout: { addressTo: string; amount: number }[]): Promise<string> {
    const feeRate = await this.feeService.getRecommendedFeeRate();
    return this.#client.sendMany(payout, feeRate);
  }

  async transferMinimalUtxo(address: string): Promise<string> {
    return this.sendUtxoToMany([{ addressTo: address, amount: Config.payIn.minDeposit.Bitcoin.BTC / 2 }]);
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.#client.getBalance();

    return [inputAmount, +availableAmount.minus(pendingAmount)];
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    const transaction = await this.#client.getTx(transferTxId);

    return transaction && transaction.blockhash && transaction.confirmations > 0;
  }

  async getRecentHistory(txCount: number): Promise<TransactionHistory[]> {
    return this.#client.getRecentHistory(txCount);
  }

  protected getClient(): BtcClient {
    return this.#client;
  }

  //*** HELPER METHODS ***//

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.findBy({ isComplete: false })).filter(
      (o) => o.targetAsset.dexName === 'BTC' && o.targetAsset.blockchain === Blockchain.BITCOIN,
    );

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
