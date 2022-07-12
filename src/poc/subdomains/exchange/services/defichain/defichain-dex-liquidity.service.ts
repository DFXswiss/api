import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';

interface LiquidityCheckRequest {
  referenceAsset: string;
  targetAsset: string;
  referenceAmount: number;
}

@Injectable()
export class DefichainDexLiquidityService {
  private dexClient: NodeClient;

  constructor(readonly nodeService: NodeService) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async checkLiquidity(request: LiquidityCheckRequest): Promise<number> {
    const requiredAmount = await this.dexClient.testCompositeSwap(
      request.referenceAsset,
      request.targetAsset,
      request.referenceAmount,
    );

    const availableAmount = await this.getAvailableTokenAmount(request.targetAsset);

    return availableAmount >= requiredAmount ? requiredAmount : 0;
  }

  async purchaseLiquidity(swapAmount: number, outputAsset: string): Promise<void> {
    const availableDFIAmount = await this.getAvailableTokenAmount('DFI');

    if (swapAmount > availableDFIAmount) {
      const errorMessage = `Not enough DFI liquidity on DEX Node. Trying to purchase ${swapAmount} DFI worth liquidity for asset ${outputAsset}. Available amount: ${availableDFIAmount}`;

      console.error(errorMessage);
      // send event instead
      // this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage);

      return;
    }

    const txId = await this.dexClient.compositeSwap(
      Config.node.dexWalletAddress,
      'DFI',
      Config.node.dexWalletAddress,
      outputAsset,
      swapAmount,
    );

    console.log('Liquidity purchase txId', txId);
  }

  private async getAvailableTokenAmount(outputAsset: string): Promise<number> {
    const tokens = await this.dexClient.getToken();
    const token = tokens.map((t) => this.dexClient.parseAmount(t.amount)).find((pt) => pt.asset === outputAsset);

    return token ? token.amount : 0;
  }
}
