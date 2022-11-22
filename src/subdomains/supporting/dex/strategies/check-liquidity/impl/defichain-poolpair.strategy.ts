import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../interfaces';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { DexUtil } from '../../../utils/dex.util';
import { CheckLiquidityUtil } from '../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class DeFiChainPoolPairStrategy extends CheckLiquidityStrategy {
  constructor(
    protected readonly assetService: AssetService,
    private readonly dexDeFiChainService: DexDeFiChainService,
  ) {
    super();
  }

  /**
   * Assume there is no pool pair liquidity available on DEX node
   * special case - availability check and target amount calculation is omitted
   */
  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount, targetAsset } = request;

    const referenceMaxPurchasableAmount = await this.calculateReferenceMaxPurchasableAmount(
      referenceAsset,
      referenceAmount,
      targetAsset,
    );

    return CheckLiquidityUtil.createNonPurchasableCheckLiquidityResult(
      request,
      0,
      0,
      await this.feeAsset(),
      referenceMaxPurchasableAmount,
    );
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }

  //*** HELPER METHODS ***//

  private async calculateReferenceMaxPurchasableAmount(
    referenceAsset: Asset,
    referenceAmount: number,
    targetAsset: Asset,
  ): Promise<number> {
    const containsDFI = this.pairContainsDFI(targetAsset);

    const token = await this.assetService.getAssetByQuery({
      dexName: containsDFI ? 'DFI' : 'DUSD',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    const requiredAmount = await this.dexDeFiChainService.calculateSwapAmountForPurchase(
      referenceAsset,
      referenceAmount,
      null,
      token,
    );

    const dfiAvailableAmount = await this.dexDeFiChainService.getAssetAvailability(token);

    // approximate, indicative calculation
    return Util.round((referenceAmount / requiredAmount) * dfiAvailableAmount, 8);
  }

  private pairContainsDFI(targetAsset: Asset): boolean {
    const pair = DexUtil.parseAssetPair(targetAsset);

    return pair.some((name) => name === 'DFI');
  }
}
