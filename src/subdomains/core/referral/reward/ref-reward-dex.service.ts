import { Injectable } from '@nestjs/common';
import { RefRewardRepository } from './ref-reward.repository';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { RefReward, RewardStatus } from './ref-reward.entity';
import { Util } from 'src/shared/utils/util';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PurchaseLiquidityRequest, ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { PriceRequestContext } from 'src/subdomains/supporting/pricing/domain/enums';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';

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
    private readonly assetService: AssetService,
    private readonly priceService: PricingService,
  ) {}

  async secureLiquidity(): Promise<void> {
    const newRefRewards = await this.refRewardRepo.find({
      where: { status: RewardStatus.PREPARED },
    });

    const groupedRewardsByBlockchain = Util.groupBy<RefReward, Blockchain>(newRefRewards, 'targetBlockchain');

    await this.processRefRewards(groupedRewardsByBlockchain);
  }

  private async processRefRewards(groupedRewards: Map<Blockchain, RefReward[]>): Promise<void> {
    for (const blockchain of groupedRewards.keys()) {
      try {
        const asset = await this.assetService.getNativeAsset(blockchain);

        // PayoutAsset Price
        const assetPrice = await this.priceService.getPrice({
          context: PriceRequestContext.REF_REWARD,
          correlationId: `${blockchain}&${Util.isoDate(new Date())}`,
          from: 'EUR',
          to: asset.dexName,
        });

        for (const reward of groupedRewards.get(blockchain)) {
          const outputAmount = Util.round(reward.amountInEur / assetPrice.price.price, 8);

          await this.checkLiquidity({
            amount: outputAmount,
            asset,
            rewardId: reward.id.toString(),
          });

          await this.refRewardRepo.update(...reward.readyToPayout(outputAmount));

          this.logger.verbose(`Secured liquidity for ref reward. Reward ID: ${reward.id}.`);
        }
      } catch (e) {
        this.logger.error(`Error in processing ref rewards for ${blockchain}:`, e);
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
