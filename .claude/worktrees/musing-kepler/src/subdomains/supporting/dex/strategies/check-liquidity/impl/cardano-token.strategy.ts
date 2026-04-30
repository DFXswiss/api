import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../interfaces';
import { DexCardanoService } from '../../../services/dex-cardano.service';
import { CheckLiquidityUtil } from '../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class CardanoTokenStrategy extends CheckLiquidityStrategy {
  constructor(
    protected readonly assetService: AssetService,
    private readonly dexCardanoService: DexCardanoService,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { referenceAmount, referenceAsset, context, correlationId } = request;

    if (referenceAsset.dexName !== this.dexCardanoService.getNativeCoin()) {
      const [targetAmount, availableAmount] = await this.dexCardanoService.checkTokenAvailability(
        referenceAsset,
        referenceAmount,
      );

      // will be different from coin implementation once token auto-purchase implemented.
      return CheckLiquidityUtil.createNonPurchasableCheckLiquidityResult(
        request,
        targetAmount,
        availableAmount,
        await this.feeAsset(),
      );
    }

    throw new Error(
      `Only token reference is supported by Cardano CheckLiquidity strategy. Provided reference asset: ${referenceAsset.dexName} Context: ${context}. CorrelationID: ${correlationId}`,
    );
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getCardanoCoin();
  }
}
