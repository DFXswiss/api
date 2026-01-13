import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementService } from 'src/subdomains/core/liquidity-management/services/liquidity-management.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { NotEnoughLiquidityException } from 'src/subdomains/supporting/dex/exceptions/not-enough-liquidity.exception';
import { ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
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
    private readonly liquidityService: LiquidityManagementService,
  ) {}

  async secureLiquidity(): Promise<void> {
    const newRefRewards = await this.refRewardRepo.find({
      where: { status: RewardStatus.PREPARED },
      relations: { liquidityPipeline: true },
    });

    const groupedRewards = Util.groupByAccessor<RefReward, number>(newRefRewards, (r) => r.outputAsset.id);

    for (const rewards of groupedRewards.values()) {
      const asset = rewards[0].outputAsset;

      // Skip if any pipeline is running for this asset
      if (rewards.some((r) => r.liquidityPipeline && !r.liquidityPipeline.isDone)) {
        continue;
      }

      try {
        const assetPrice = await this.priceService.getPrice(PriceCurrency.EUR, asset, PriceValidity.VALID_ONLY);

        for (const reward of rewards) {
          try {
            const outputAmount = assetPrice.convert(reward.amountInEur, 8);

            await this.reserveLiquidity({
              amount: outputAmount,
              asset,
              rewardId: reward.id.toString(),
            });

            await this.refRewardRepo.update(...reward.readyToPayout(outputAmount));
          } catch (e) {
            if (e instanceof NotEnoughLiquidityException) {
              // Start ONE pipeline for ALL remaining rewards
              const remainingRewards = rewards.filter((r) => r.status === RewardStatus.PREPARED);
              const totalAmount = Util.round(
                remainingRewards.reduce((sum, r) => sum + assetPrice.convert(r.amountInEur, 8), 0),
                8,
              );
              await this.startLiquidityPipeline(remainingRewards, asset, totalAmount);
              break;
            }

            this.logger.error(`Error in processing ref reward ${reward.id}:`, e);
          }
        }
      } catch (e) {
        this.logger.error(`Error in processing ref rewards for ${asset.uniqueName}:`, e);
      }
    }
  }

  private async startLiquidityPipeline(rewards: RefReward[], asset: Asset, amount: number): Promise<void> {
    try {
      const pipeline = await this.liquidityService.buyLiquidity(asset.id, amount, amount, true);
      this.logger.info(`Missing ref-reward liquidity. Liquidity management order created: ${pipeline.id}`);

      for (const reward of rewards) {
        await this.refRewardRepo.update(reward.id, { liquidityPipeline: pipeline });
      }
    } catch (e) {
      this.logger.error(`Failed to start liquidity pipeline for ref rewards (${asset.uniqueName}):`, e);
    }
  }

  private async reserveLiquidity(request: RefLiquidityRequest): Promise<number> {
    return this.dexService.reserveLiquidity(this.createReserveLiquidityRequest(request));
  }

  private createReserveLiquidityRequest(request: RefLiquidityRequest): ReserveLiquidityRequest {
    return {
      context: LiquidityOrderContext.REF_PAYOUT,
      correlationId: request.rewardId,
      referenceAsset: request.asset,
      referenceAmount: request.amount,
      targetAsset: request.asset,
    };
  }
}
