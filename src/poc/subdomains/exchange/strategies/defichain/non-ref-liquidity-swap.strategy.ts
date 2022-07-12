import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { LiquiditySwapStrategy, SwapRequest } from './liquidity-swap.strategy';

@Injectable()
export class NonReferenceLiquiditySwapStrategy extends LiquiditySwapStrategy {
  private dexClient: DeFiClient;

  constructor(nodeService: NodeService) {
    super();
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async calculateLiquiditySwapAmount(request: SwapRequest): Promise<number> {
    return this.dexClient.testCompositeSwap(request.asset, 'DFI', request.amount);
  }
}
