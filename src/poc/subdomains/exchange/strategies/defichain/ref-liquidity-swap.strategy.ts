import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Util } from 'src/shared/util';
import { LiquiditySwapStrategy, SwapRequest } from './liquidity-swap.strategy';

@Injectable()
export class ReferenceLiquiditySwapStrategy extends LiquiditySwapStrategy {
  private dexClient: DeFiClient;

  constructor(nodeService: NodeService) {
    super();
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async calculateLiquiditySwapAmount(request: SwapRequest): Promise<number> {
    const minimalOutputReferenceAmount = request.asset === 'BTC' ? 0.001 : 1;

    const referencePrice =
      (await this.dexClient.testCompositeSwap(request.asset, 'DFI', minimalOutputReferenceAmount)) /
      minimalOutputReferenceAmount;

    const swapAmount = request.amount * referencePrice;

    // adding 3% reserve cap for non-reference asset liquidity swap
    return Util.round(swapAmount + swapAmount * 0.05, 8);
  }
}
