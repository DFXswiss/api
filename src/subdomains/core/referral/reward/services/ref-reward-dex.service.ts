import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { PurchaseLiquidityRequest, ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { RefReward, RewardStatus } from '../ref-reward.entity';
import { RefRewardRepository } from '../ref-reward.repository';

export interface RefLiquidityRequest {
  amount: number;
  asset: Asset;
  rewardId: string;
}

@Injectable()
export class RefRewardDexService {
  constructor(
    private readonly refRewardRepo: RefRewardRepository,
    private readonly dexService: DexService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
    private readonly priceService: PricingService,
    private readonly logger: DfxLoggerService,
  ) {
    this.logger.create(RefRewardDexService);
  }

  async secureLiquidity(): Promise<void> {
    const newRefRewards = await this.refRewardRepo.find({
      where: { status: RewardStatus.PREPARED },
    });

    const groupedRewardsByBlockchain = Util.groupBy<RefReward, Blockchain>(newRefRewards, 'targetBlockchain');

    await this.processRefRewards(groupedRewardsByBlockchain);
  }

  private async processRefRewards(groupedRewards: Map<Blockchain, RefReward[]>): Promise<void> {
    const eur = await this.fiatService.getFiatByName('EUR');

    for (const blockchain of groupedRewards.keys()) {
      try {
        const asset = await this.assetService.getNativeAsset(blockchain);

        // payout asset Price
        const assetPrice = await this.priceService.getPrice(eur, asset, false);

        for (const reward of groupedRewards.get(blockchain)) {
          const outputAmount = assetPrice.convert(reward.amountInEur, 8);

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
