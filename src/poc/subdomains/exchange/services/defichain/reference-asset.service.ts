import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Util } from 'src/shared/util';

interface SwapRequest {
  asset: string;
  amount: number;
}

@Injectable()
export class DefichainReferenceAssetService {
  private dexClient: NodeClient;

  constructor(nodeService: NodeService) {
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
