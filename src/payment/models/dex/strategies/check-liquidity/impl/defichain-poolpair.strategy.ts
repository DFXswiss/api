import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/util';
import { CheckLiquidityResult, LiquidityRequest } from '../../../interfaces';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
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
  async checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount } = request;

    const referenceMaxPurchasableAmount = await this.calculateReferenceMaxPurchasableAmount(
      referenceAsset,
      referenceAmount,
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
    return this.assetService.getAssetByQuery({
      dexName: 'DFI',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.COIN,
    });
  }

  //*** HELPER METHODS ***//

  private async calculateReferenceMaxPurchasableAmount(
    referenceAsset: Asset,
    referenceAmount: number,
  ): Promise<number> {
    const dfiToken = await this.assetService.getAssetByQuery({
      dexName: 'DFI',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    const dfiRequiredAmount = await this.dexDeFiChainService.getSwapAmountForPurchase(
      referenceAsset,
      referenceAmount,
      null,
      dfiToken,
    );

    const dfiAvailableAmount = await this.dexDeFiChainService.getAssetAvailability(dfiToken);

    // approximate, indicative calculation
    return Util.round((referenceAmount / dfiRequiredAmount) * dfiAvailableAmount, 8);
  }
}
