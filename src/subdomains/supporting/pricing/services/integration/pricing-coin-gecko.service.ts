import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from '../../domain/interfaces';
import { CoinGeckoService } from './coin-gecko.service';

// TODO: temporary solution
@Injectable()
export class PricingCoinGeckoService implements PricingProvider {
  name = 'CoinGecko';

  constructor(
    private readonly coinGeckoService: CoinGeckoService,
    private readonly assetService: AssetService,
    private readonly fiatService: FiatService,
  ) {}

  async getPrice(from: string, to: string): Promise<Price> {
    const fiat = await this.fiatService.getFiatByName(from);
    const asset = await this.assetService.getAssetByQuery({
      blockchain: Blockchain.ETHEREUM,
      type: AssetType.TOKEN,
      dexName: to,
    });

    return this.coinGeckoService.fromFiat(fiat, asset);
  }
}
