import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../interfaces';
import { DexArkService } from '../../../services/dex-ark.service';
import { CheckLiquidityUtil } from '../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class ArkStrategy extends CheckLiquidityStrategy {
  constructor(
    private readonly assetService: AssetService,
    private readonly dexArkService: DexArkService,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.ARK;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { context, correlationId, referenceAsset, referenceAmount: bitcoinAmount } = request;

    if (referenceAsset.dexName === 'BTC') {
      const [targetAmount, availableAmount] = await this.dexArkService.checkAvailableTargetLiquidity(bitcoinAmount);

      return CheckLiquidityUtil.createNonPurchasableCheckLiquidityResult(
        request,
        targetAmount,
        availableAmount,
        await this.feeAsset(),
      );
    }

    throw new Error(
      `Only native coin reference is supported by Ark CheckLiquidity strategy. Provided reference asset: ${referenceAsset.dexName} Context: ${context}. CorrelationID: ${correlationId}`,
    );
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArkCoin();
  }
}
