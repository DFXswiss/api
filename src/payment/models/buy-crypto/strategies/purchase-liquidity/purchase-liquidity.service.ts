import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetCategory } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/util';
import { BuyCryptoBatch } from '../../entities/buy-crypto-batch.entity';
import { BuyCryptoNotificationService } from '../../services/buy-crypto-notification.service';
import { PurchaseLiquidityDefaultStrategy } from './purchase-default.strategy';
import { PurchaseDTokenStrategy } from './purchase-dtoken.strategy';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.interface';

@Injectable()
export class PurchaseLiquidityService {
  #dexClient: DeFiClient;
  #strategies = new Map<AssetCategory | 'default', PurchaseLiquidityStrategy>();

  constructor(
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
    private readonly assetService: AssetService,
    readonly nodeService: NodeService,
  ) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.#dexClient = client));

    this.#strategies.set(AssetCategory.D_TOKEN, new PurchaseDTokenStrategy());
    this.#strategies.set('default', new PurchaseLiquidityDefaultStrategy());
  }

  async purchaseLiquidity(batch: BuyCryptoBatch): Promise<string> {
    const targetAsset = await this.assetService.getAssetByDexName(batch.outputAsset);
    const swapAsset = targetAsset.category === AssetCategory.D_TOKEN ? 'DUSD' : 'DFI';
    // protect from slippage
    // add a cap for availability check
    // implement purchase strategies for different asset categories

    const basePrice = await this.#dexClient.testCompositeSwap(swapAsset, batch.outputAsset, 1);
    const swapAmount = await this.calculateLiquiditySwapAmount(batch);
    const availableDFIAmount = await this.getAvailableTokenAmount(swapAsset);

    if (swapAmount * 1.05 > availableDFIAmount) {
      const errorMessage = `Not enough DFI liquidity on DEX Node. Trying to purchase ${swapAmount} DFI worth liquidity for asset ${batch.outputAsset}. Available amount: ${availableDFIAmount}`;

      console.error(errorMessage);
      this.buyCryptoNotificationService.sendNonRecoverableErrorMail(errorMessage);

      return;
    }

    const txId = await this.#dexClient.compositeSwap(
      Config.node.dexWalletAddress,
      'DFI',
      Config.node.dexWalletAddress,
      batch.outputAsset,
      swapAmount,
      [],
      Util.round(basePrice + basePrice * batch.maxPriceSlippage, 8),
    );

    console.info(
      `Purchased ${swapAmount} DFI worth liquidity for asset ${batch.outputAsset}. Batch ID: ${batch.id}. Transaction ID: ${txId}`,
    );

    return txId;

    // if (targetAsset.category === AssetCategory.D_TOKEN) {
    //   return this.#strategies.get(AssetCategory.D_TOKEN).purchase(targetAsset, referenceAsset, referenceAmount);
    // }

    // return this.#strategies.get('default').purchase(targetAsset, referenceAsset, referenceAmount);
  }

  private async calculateLiquiditySwapAmount(batch: BuyCryptoBatch): Promise<number> {
    if (batch.isReferenceAsset) {
      const referencePrice =
        (await this.#dexClient.testCompositeSwap(
          batch.outputReferenceAsset,
          'DFI',
          batch.minimalOutputReferenceAmount,
        )) / batch.minimalOutputReferenceAmount;

      const swapAmount = batch.outputReferenceAmount * referencePrice;

      // adding 3% reserve cap for non-reference asset liquidity swap
      return Util.round(swapAmount + swapAmount * 0.05, 8);
    }

    return this.#dexClient.testCompositeSwap(batch.outputReferenceAsset, 'DFI', batch.outputReferenceAmount);
  }

  private async getAvailableTokenAmount(outputAsset: string): Promise<number> {
    const tokens = await this.#dexClient.getToken();
    const token = tokens.map((t) => this.#dexClient.parseAmount(t.amount)).find((pt) => pt.asset === outputAsset);

    return token ? token.amount : 0;
  }
}
