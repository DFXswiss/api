import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { v4 as uuid } from 'uuid';
import { LiquidityOrderContext } from '../../../dex/entities/liquidity-order.entity';
import { CheckLiquidityRequest } from '../../../dex/interfaces';
import { DexService } from '../../../dex/services/dex.service';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from '../../domain/interfaces';

@Injectable()
export class PricingDeFiChainService implements PricingProvider {
  name: string;

  constructor(private dexService: DexService, private assetService: AssetService) {
    this.name = 'DeFiChain';
  }

  async getPrice(from: string, to: string): Promise<Price> {
    const fromAsset = await this.assetService.getAssetByQuery({
      dexName: from,
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    const toAsset = await this.assetService.getAssetByQuery({
      dexName: to,
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    const liquidityRequest: CheckLiquidityRequest = {
      context: LiquidityOrderContext.PRICING,
      correlationId: uuid(),
      referenceAsset: fromAsset,
      referenceAmount: fromAsset.minimalPriceReferenceAmount,
      targetAsset: toAsset,
    };

    const { target } = await this.dexService.checkLiquidity(liquidityRequest);

    return Price.create(from, to, Util.round(fromAsset.minimalPriceReferenceAmount / target.amount, 8));
  }
}
