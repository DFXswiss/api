import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityOrder } from '../../../entities/liquidity-order.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../interfaces';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { CheckLiquidityUtil } from '../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class DeFiChainStrategy extends CheckLiquidityStrategy {
  protected readonly logger = new DfxLogger(DeFiChainStrategy);

  constructor(private readonly dexDeFiChainService: DexDeFiChainService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.DEFICHAIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAsset, referenceAmount, targetAsset } = request;

    const prioritySwapAssets = await this.getPrioritySwapAssets(targetAsset);

    const liquidity = await this.dexDeFiChainService.getAndCheckAvailableTargetLiquidity(
      referenceAsset,
      referenceAmount,
      targetAsset,
      LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
      prioritySwapAssets,
    );

    return CheckLiquidityUtil.createCheckLiquidityResult(request, liquidity, await this.feeAsset());
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }
}
