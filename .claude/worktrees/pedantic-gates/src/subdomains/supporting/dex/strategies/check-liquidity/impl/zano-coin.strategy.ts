import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../interfaces';
import { DexZanoService } from '../../../services/dex-zano.service';
import { CheckLiquidityUtil } from '../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class ZanoCoinStrategy extends CheckLiquidityStrategy {
  constructor(
    protected readonly assetService: AssetService,
    private readonly dexZanoService: DexZanoService,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount: nativeCoinAmount, context, correlationId } = request;

    if (referenceAsset.dexName === this.dexZanoService.getNativeCoin()) {
      const [targetAmount, availableAmount] = await this.dexZanoService.checkCoinAvailability(nativeCoinAmount);

      return CheckLiquidityUtil.createNonPurchasableCheckLiquidityResult(
        request,
        targetAmount,
        availableAmount,
        await this.feeAsset(),
      );
    }

    // only native coin is enabled as a referenceAsset
    throw new Error(
      `Only native coin reference is supported by Zano CheckLiquidity strategy. Provided reference asset: ${referenceAsset.dexName} Context: ${context}. CorrelationID: ${correlationId}`,
    );
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getZanoCoin();
  }
}
