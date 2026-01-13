import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementPipelineStatus } from 'src/subdomains/core/liquidity-management/enums';
import { LiquidityManagementService } from 'src/subdomains/core/liquidity-management/services/liquidity-management.service';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import {
  CheckLiquidityRequest,
  PurchaseLiquidityRequest,
  ReserveLiquidityRequest,
} from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In } from 'typeorm';
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
    // Load all relevant rewards in a single query
    const allRewards = await this.refRewardRepo.find({
      where: { status: In([RewardStatus.PREPARED, RewardStatus.PENDING_LIQUIDITY]) },
      relations: { liquidityPipeline: true },
    });

    const preparedRewards = allRewards.filter((r) => r.status === RewardStatus.PREPARED);
    const pendingLiquidityRewards = allRewards.filter((r) => r.status === RewardStatus.PENDING_LIQUIDITY);

    await this.processPendingLiquidityRewards(pendingLiquidityRewards);
    await this.processNewRewards(preparedRewards, pendingLiquidityRewards);
  }

  private async processNewRewards(newRefRewards: RefReward[], pendingLiquidityRewards: RefReward[]): Promise<void> {
    // Get assets with pending liquidity pipelines to avoid processing them
    const assetsWithPendingPipeline = new Set(
      pendingLiquidityRewards
        .filter(
          (r) =>
            r.outputAsset &&
            r.liquidityPipeline &&
            [LiquidityManagementPipelineStatus.CREATED, LiquidityManagementPipelineStatus.IN_PROGRESS].includes(
              r.liquidityPipeline.status,
            ),
        )
        .map((r) => r.outputAsset.id),
    );

    const groupedRewards = Util.groupByAccessor<RefReward, number>(newRefRewards, (r) => r.outputAsset.id);

    for (const rewards of groupedRewards.values()) {
      const asset = rewards[0].outputAsset;

      // Skip if a pipeline is already running for this asset
      if (assetsWithPendingPipeline.has(asset.id)) {
        this.logger.verbose(`Skipping ref rewards for ${asset.uniqueName}: pipeline already running`);
        continue;
      }

      try {
        const assetPrice = await this.priceService.getPrice(PriceCurrency.EUR, asset, PriceValidity.VALID_ONLY);

        // Calculate total output amount for all rewards of this asset
        const totalOutputAmount = Util.round(
          rewards.reduce((sum, r) => sum + assetPrice.convert(r.amountInEur, 8), 0),
          8,
        );

        // Check if liquidity is available
        const liquidity = await this.dexService.checkLiquidity(
          this.createCheckLiquidityRequest(asset, totalOutputAmount),
        );

        if (liquidity.target.availableAmount < totalOutputAmount) {
          // Not enough liquidity - start pipeline
          await this.startLiquidityPipeline(rewards, asset, totalOutputAmount, liquidity.target.availableAmount);
          continue;
        }

        // Enough liquidity - process rewards individually
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
            this.logger.error(`Error in processing ref reward ${reward.id}:`, e);
            continue;
          }
        }
      } catch (e) {
        this.logger.error(`Error in processing ref rewards for ${asset.uniqueName}:`, e);
      }
    }
  }

  private async processPendingLiquidityRewards(pendingRewards: RefReward[]): Promise<void> {
    // Reset rewards without pipeline to PREPARED (pipeline creation failed)
    for (const reward of pendingRewards.filter((r) => !r.liquidityPipeline)) {
      try {
        this.logger.info(`Resetting ref reward ${reward.id} without pipeline to PREPARED`);
        await this.refRewardRepo.update(...reward.resetToPrepared());
      } catch (e) {
        this.logger.error(`Error resetting ref reward ${reward.id} to PREPARED:`, e);
        continue;
      }
    }

    const rewardsWithPipeline = pendingRewards.filter((r) => r.liquidityPipeline);
    const groupedRewards = Util.groupByAccessor<RefReward, number>(rewardsWithPipeline, (r) => r.liquidityPipeline.id);

    for (const rewards of groupedRewards.values()) {
      const pipeline = rewards[0].liquidityPipeline;

      // Pipeline failed/stopped: Reset to PREPARED for retry
      if (
        [LiquidityManagementPipelineStatus.FAILED, LiquidityManagementPipelineStatus.STOPPED].includes(pipeline.status)
      ) {
        this.logger.info(`Pipeline ${pipeline.id} failed/stopped, resetting ref rewards to PREPARED`);
        for (const reward of rewards) {
          try {
            await this.refRewardRepo.update(...reward.resetToPrepared());
          } catch (e) {
            this.logger.error(`Error resetting ref reward ${reward.id} to PREPARED:`, e);
            continue;
          }
        }
        continue;
      }

      // Pipeline not complete yet
      if (pipeline.status !== LiquidityManagementPipelineStatus.COMPLETE) {
        continue;
      }

      // Pipeline complete - process rewards with current price
      const asset = rewards[0].outputAsset;

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
            this.logger.error(`Error in processing pending liquidity ref reward ${reward.id}:`, e);
            continue;
          }
        }
      } catch (e) {
        this.logger.error(`Error getting price for pending liquidity ref rewards (${asset.uniqueName}):`, e);
      }
    }
  }

  private async startLiquidityPipeline(
    rewards: RefReward[],
    asset: Asset,
    totalAmount: number,
    availableAmount: number,
  ): Promise<void> {
    const deficit = Util.round(totalAmount - availableAmount, 8);

    try {
      // First create the pipeline
      const pipeline = await this.liquidityService.buyLiquidity(asset.id, deficit, deficit, true);
      this.logger.info(
        `Started liquidity pipeline ${pipeline.id} for ref rewards (deficit: ${deficit} ${asset.uniqueName})`,
      );

      // Then update rewards atomically with status AND pipeline
      for (const reward of rewards) {
        try {
          await this.refRewardRepo.update(...reward.pendingLiquidity(pipeline));
        } catch (e) {
          this.logger.error(`Error setting pending liquidity for ref reward ${reward.id}:`, e);
          continue;
        }
      }
    } catch (e) {
      this.logger.error(`Failed to start liquidity pipeline for ref rewards (${asset.uniqueName}):`, e);
      // Pipeline creation failed - rewards stay in PREPARED status, will retry next run
    }
  }

  private async reserveLiquidity(request: RefLiquidityRequest): Promise<number> {
    const reserveRequest = this.createReserveLiquidityRequest(request);

    return this.dexService.reserveLiquidity(reserveRequest);
  }

  private createCheckLiquidityRequest(asset: Asset, amount: number): CheckLiquidityRequest {
    return {
      context: LiquidityOrderContext.REF_PAYOUT,
      correlationId: 'ref-liquidity-check',
      referenceAsset: asset,
      referenceAmount: amount,
      targetAsset: asset,
    };
  }

  private createReserveLiquidityRequest(
    request: RefLiquidityRequest,
  ): PurchaseLiquidityRequest | ReserveLiquidityRequest {
    return {
      context: LiquidityOrderContext.REF_PAYOUT,
      correlationId: request.rewardId,
      referenceAsset: request.asset,
      referenceAmount: request.amount,
      targetAsset: request.asset,
    };
  }
}
