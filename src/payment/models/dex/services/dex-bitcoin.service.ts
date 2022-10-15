import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/blockchain/ain/node/node.service';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexBitcoinService {
  #client: BtcClient;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, readonly nodeService: NodeService) {
    nodeService.getConnectedNode(NodeType.BTC_OUTPUT).subscribe((client) => (this.#client = client));
  }

  async checkAvailableTargetLiquidity(amount: number): Promise<number> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.#client.getBalance();

    this.checkLiquidity(amount, pendingAmount, +availableAmount);

    return amount;
  }

  //*** HELPER METHODS ***//

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.find({ isReady: true, isComplete: false })).filter(
      (o) => o.targetAsset.dexName === 'BTC' && o.targetAsset.blockchain === Blockchain.BITCOIN,
    );

    return Util.sumObj<LiquidityOrder>(pendingOrders, 'targetAmount');
  }

  private checkLiquidity(requiredAmount: number, pendingAmount: number, availableAmount: number): void {
    if (requiredAmount > availableAmount - pendingAmount) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset BTC. Trying to use ${requiredAmount} BTC worth liquidity. Available amount: ${availableAmount}. Pending amount: ${pendingAmount}`,
      );
    }
  }
}
