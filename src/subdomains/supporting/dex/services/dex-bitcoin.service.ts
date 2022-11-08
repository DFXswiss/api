import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexBitcoinService {
  #client: BtcClient;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, readonly nodeService: NodeService) {
    nodeService.getConnectedNode(NodeType.BTC_OUTPUT).subscribe((client) => (this.#client = client));
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.#client.getBalance();

    return [inputAmount, +availableAmount - pendingAmount];
  }

  //*** HELPER METHODS ***//

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = (await this.liquidityOrderRepo.find({ isReady: true, isComplete: false })).filter(
      (o) => o.targetAsset.dexName === 'BTC' && o.targetAsset.blockchain === Blockchain.BITCOIN,
    );

    return Util.sumObj<LiquidityOrder>(pendingOrders, 'targetAmount');
  }
}
