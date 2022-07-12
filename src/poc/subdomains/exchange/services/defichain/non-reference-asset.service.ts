import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';

interface SwapRequest {
  asset: string;
  amount: number;
}

@Injectable()
export class DefichainNonReferenceAssetService {
  private dexClient: NodeClient;

  constructor(nodeService: NodeService) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async calculateLiquiditySwapAmount(request: SwapRequest): Promise<number> {
    return await this.dexClient.testCompositeSwap(request.asset, 'DFI', request.amount);
  }
}
