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
    await this.processNewRewards();
    await this.processPendingLiquidityRewards();
  }

  private async processNewRewards(): Promise<void> {
    const newRefRewards = await this.refRewardRepo.find({
      where: { status: RewardStatus.PREPARED },
    });

    // Get assets with pending liquidity pipelines to avoid processing them
    const pendingLiquidityRewards = await this.refRewardRepo.find({
      where: { status: RewardStatus.PENDING_LIQUIDITY },
      relations: { liquidityPipeline: true },
    });
    const assetsWithPendingPipeline = new Set(
      pendingLiquidityRewards
        .filter(
          (r) =>
            r.outputAsset &&
            [LiquidityManagementPipelineStatus.CREATED, LiquidityManagementPipelineStatus.IN_PROGRESS].includes(
              r.liquidityPipeline?.status,
            ),
        )
        .map((r) => r.outputAsset.id),
    );

    const groupedRewards = Util.groupByAccessor<RefReward, number>(newRefRewards, (r) => r.outputAsset.id);

    for (const rewards of groupedRewards.values()) {
      try {
        const asset = rewards[0].outputAsset;

        // Skip if a pipeline is already running for this asset
        if (assetsWithPendingPipeline.has(asset.id)) {
          this.logger.verbose(`Skipping ref rewards for ${asset.uniqueName}: pipeline already running`);
          continue;
        }

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

        // Enough liquidity - process rewards normally
        for (const reward of rewards) {
          const outputAmount = assetPrice.convert(reward.amountInEur, 8);

          await this.reserveLiquidity({
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

  private async processPendingLiquidityRewards(): Promise<void> {
    const pendingRewards = await this.refRewardRepo.find({
      where: { status: RewardStatus.PENDING_LIQUIDITY },
      relations: { liquidityPipeline: true },
    });

    // Reset rewards without pipeline to PREPARED (pipeline creation failed)
    const rewardsWithoutPipeline = pendingRewards.filter((r) => !r.liquidityPipeline);
    if (rewardsWithoutPipeline.length) {
      this.logger.info(`Resetting ${rewardsWithoutPipeline.length} ref rewards without pipeline to PREPARED`);
      await this.refRewardRepo.update(
        { id: In(rewardsWithoutPipeline.map((r) => r.id)) },
        { status: RewardStatus.PREPARED },
      );
    }

    const rewardsWithPipeline = pendingRewards.filter((r) => r.liquidityPipeline);
    const groupedRewards = Util.groupByAccessor<RefReward, number>(rewardsWithPipeline, (r) => r.liquidityPipeline.id);

    for (const rewards of groupedRewards.values()) {
      try {
        const pipeline = rewards[0].liquidityPipeline;

        // Pipeline failed/stopped: Reset to PREPARED for retry
        if (
          [LiquidityManagementPipelineStatus.FAILED, LiquidityManagementPipelineStatus.STOPPED].includes(
            pipeline.status,
          )
        ) {
          this.logger.info(`Pipeline ${pipeline.id} failed/stopped, resetting ref rewards to PREPARED`);
          await this.refRewardRepo.update(
            { id: In(rewards.map((r) => r.id)) },
            { status: RewardStatus.PREPARED, liquidityPipeline: null },
          );
          continue;
        }

        // Pipeline not complete yet
        if (pipeline.status !== LiquidityManagementPipelineStatus.COMPLETE) {
          continue;
        }

        // Pipeline complete - process rewards with current price
        const asset = rewards[0].outputAsset;
        const assetPrice = await this.priceService.getPrice(PriceCurrency.EUR, asset, PriceValidity.VALID_ONLY);

        for (const reward of rewards) {
          const outputAmount = assetPrice.convert(reward.amountInEur, 8);

          await this.reserveLiquidity({
            amount: outputAmount,
            asset,
            rewardId: reward.id.toString(),
          });

          await this.refRewardRepo.update(...reward.readyToPayout(outputAmount));
        }
      } catch (e) {
        this.logger.error(`Error in processing pending liquidity ref rewards:`, e);
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

    // Set status BEFORE pipeline attempt (consistent with BuyCrypto)
    await this.refRewardRepo.update({ id: In(rewards.map((r) => r.id)) }, { status: RewardStatus.PENDING_LIQUIDITY });

    try {
      const pipeline = await this.liquidityService.buyLiquidity(asset.id, deficit, deficit, true);
      this.logger.info(
        `Started liquidity pipeline ${pipeline.id} for ref rewards (deficit: ${deficit} ${asset.uniqueName})`,
      );

      await this.refRewardRepo.update({ id: In(rewards.map((r) => r.id)) }, { liquidityPipeline: pipeline });
    } catch (e) {
      this.logger.error(`Failed to start liquidity pipeline for ref rewards (${asset.uniqueName}):`, e);
      // Status remains PENDING_LIQUIDITY without pipeline - will be reset to PREPARED in processPendingLiquidityRewards()
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
