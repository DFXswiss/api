import { Injectable } from '@nestjs/common';
import { RefRewardRepository } from './ref-reward.repository';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { RefReward, RewardStatus } from './ref-reward.entity';
import { Util } from 'src/shared/utils/util';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { NotEnoughLiquidityException } from 'src/subdomains/supporting/dex/exceptions/not-enough-liquidity.exception';
import { PurchaseLiquidityRequest, ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';

export interface RefLiquidityRequest {
  amount: number;
  asset: Asset;
  batchId: string;
}

@Injectable()
export class RefRewardDexService {
  constructor(
    private readonly refRewardRepo: RefRewardRepository,
    private readonly dexService: DexService,
    private readonly assetService: AssetService,
  ) {}

  async secureLiquidity(): Promise<void> {
    try {
      const newRefRewards = await this.refRewardRepo.find({
        where: { status: RewardStatus.PREPARED },
      });

      const groupedRewardsByBlockchain = Util.groupByAccessor<RefReward, Blockchain>(
        newRefRewards,
        (o) => o.targetBlockchain,
      );

      await this.processRefRewards(groupedRewardsByBlockchain);
    } catch (e) {
      console.error(e);
    }
  }

  private async processRefRewards(groupedRewards: Map<Blockchain, RefReward[]>): Promise<void> {
    for (const blockchain of groupedRewards.keys()) {
      try {
        const asset = await this.assetService.getNativeAsset(blockchain);

        for (const reward of groupedRewards.get(blockchain)) {
          const liquidity = await this.checkLiquidity({
            amount: reward.outputAmount,
            asset,
            batchId: reward.id.toString(),
          });

          if (liquidity !== 0) {
            await this.refRewardRepo.update(reward.id, { status: RewardStatus.READY_FOR_PAYOUT });

            console.info(`Secured liquidity for ref reward. Reward ID: ${reward.id}.`);

            continue;
          }

          throw new NotEnoughLiquidityException('Not enough liquidity for ref reward');
        }
      } catch (e) {
        console.info(`Error in processing new ref reward. Blockchain: ${blockchain}.`, e.message);
      }
    }
  }

  private async checkLiquidity(request: RefLiquidityRequest): Promise<number> {
    try {
      const reserveRequest = await this.createLiquidityRequest(request);

      return await this.dexService.reserveLiquidity(reserveRequest);
    } catch (e) {
      if (e instanceof NotEnoughLiquidityException) {
        console.info(e.message);
        return 0;
      }

      throw new Error(`Error in checking liquidity for a ref reward, ID: ${request.batchId}. ${e.message}`);
    }
  }

  private async createLiquidityRequest(
    request: RefLiquidityRequest,
  ): Promise<PurchaseLiquidityRequest | ReserveLiquidityRequest> {
    return {
      context: LiquidityOrderContext.REF_PAYOUT,
      correlationId: request.batchId,
      referenceAsset: request.asset,
      referenceAmount: request.amount,
      targetAsset: request.asset,
    };
  }
}
