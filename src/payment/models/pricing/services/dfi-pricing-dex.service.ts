import { v4 as uuid } from 'uuid';
import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityOrderContext } from '../../dex/entities/liquidity-order.entity';
import { LiquidityRequest } from '../../dex/interfaces';
import { DexService } from '../../dex/services/dex.service';
import { Price } from '../../exchange/dto/price.dto';
import { PriceProvider } from '../interfaces';
import { Util } from 'src/shared/util';
import { AssetType } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class DfiPricingDexService implements PriceProvider {
  name: string;

  constructor(private dexService: DexService, private assetService: AssetService) {
    this.name = 'DfiDex';
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (to !== 'DFI') {
      throw new Error(`DfiPricingDexService supports only DFI as target asset, instead provided: ${to}`);
    }

    const dfi = await this.assetService.getAssetByQuery({ dexName: 'DFI', blockchain: Blockchain.DEFICHAIN, type: AssetType.TOKEN });

    const liquidityRequest: LiquidityRequest = {
      context: LiquidityOrderContext.PRICING,
      correlationId: uuid(),
      referenceAsset: from,
      referenceAmount: 0.001,
      targetAsset: dfi,
      options: {
        bypassAvailabilityCheck: true,
        bypassSlippageProtection: true,
      },
    };

    const targetAmount = await this.dexService.checkLiquidity(liquidityRequest);

    return Price.create(from, to, Util.round(targetAmount / 0.001, 8));
  }
}
