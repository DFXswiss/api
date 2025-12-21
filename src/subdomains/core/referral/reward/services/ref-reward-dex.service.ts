import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { PurchaseLiquidityRequest, ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { RefReward, RewardStatus } from '../ref-reward.entity';
import { RefRewardRepository } from '../ref-reward.repository';

export interface RefLiquidityRequest {
  amount: number;
  asset: Asset;
  rewardId: string;
}

@Injectable()
export class RefRewardDexService {
  private readonly logger = new DfxLogger(RefRewardDexService);

  constructor(
    private readonly refRewardRepo: RefRewardRepository,
    private readonly dexService: DexService,
    private readonly priceService: PricingService,
  ) {}

  async secureLiquidity(): Promise<void> {
    const newRefRewards = await this.refRewardRepo.find({
      where: { status: RewardStatus.PREPARED },
    });

    const groupedRewards = Util.groupByAccessor<RefReward, number>(newRefRewards, (r) => r.outputAsset.id);

    for (const rewards of groupedRewards.values()) {
      try {
        // payout asset price
        const asset = rewards[0].outputAsset;
        const assetPrice = await this.priceService.getPrice(PriceCurrency.EUR, asset, PriceValidity.VALID_ONLY);

        for (const reward of rewards) {
          const outputAmount = assetPrice.convert(reward.amountInEur, 8);

          await this.checkLiquidity({
            amount: outputAmount,
            asset,
            rewardId: reward.id.toString(),
          });

          await this.refRewardRepo.update(...reward.readyToPayout(outputAmount));
        }
      } catch (e) {
        this.logger.error(`Error in processing ref rewards for ${rewards[0].outputAsset.uniqueName}:`, e);
      }
    }
  }

  private async checkLiquidity(request: RefLiquidityRequest): Promise<number> {
    const reserveRequest = this.createLiquidityRequest(request);

    return this.dexService.reserveLiquidity(reserveRequest);
  }

  private createLiquidityRequest(request: RefLiquidityRequest): PurchaseLiquidityRequest | ReserveLiquidityRequest {
    return {
      context: LiquidityOrderContext.REF_PAYOUT,
      correlationId: request.rewardId,
      referenceAsset: request.asset,
      referenceAmount: request.amount,
      targetAsset: request.asset,
    };
  }
}
