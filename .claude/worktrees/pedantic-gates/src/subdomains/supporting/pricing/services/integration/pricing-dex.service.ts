import { Injectable } from '@nestjs/common';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from '../../../dex/services/dex.service';
import { Price, PriceStep } from '../../domain/entities/price';
import { PriceRule } from '../../domain/entities/price-rule.entity';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingDexService extends PricingProvider {
  constructor(
    private dexService: DexService,
    private assetService: AssetService,
  ) {
    super();
  }

  async getPrice(from: string, to: string, param?: string): Promise<Price> {
    const fromAsset = await this.assetService.getAssetByUniqueName(from);
    const toAsset = await this.assetService.getAssetByUniqueName(to);

    const price = await this.dexService.calculatePrice(fromAsset, toAsset, param && +param);
    return Price.create(from, to, price);
  }

  getPriceStep(rule: PriceRule): PriceStep {
    const chain = rule.priceAsset.split('/')[0];
    const poolFee = rule.rule.param ? ` (${EvmUtil.poolFeeFactor(+rule.rule.param) * 100}%)` : '';

    return PriceStep.create(
      `${chain} Uniswap v3${poolFee}`,
      rule.from,
      rule.to,
      rule.currentPrice,
      rule.priceTimestamp,
    );
  }
}
