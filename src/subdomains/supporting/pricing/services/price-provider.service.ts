import { Injectable, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Price } from '../domain/entities/price';
import { CoinGeckoService } from './integration/coin-gecko.service';
import { CurrencyService } from './integration/currency.service';

/**
 * Price provider service - use this service for indicative prices
 */
@Injectable()
export class PriceProviderService implements OnModuleInit {
  private readonly refAssetMap = new Map<Blockchain, Asset>();

  private eur: Fiat;

  constructor(
    private readonly assetService: AssetService,
    private readonly coinGeckoService: CoinGeckoService,
    private readonly currencyService: CurrencyService,
    private readonly fiatService: FiatService,
  ) {}

  onModuleInit() {
    void this.fiatService.getFiatByName('EUR').then((a) => (this.eur = a));
  }

  // --- CONVERSION METHODS --- //
  private async cryptoCrypto(from: Asset, to: Asset): Promise<Price> {
    if (from.id === to.id) return Price.create(from.dexName, to.dexName, 1);

    return this.coinGeckoService.getCryptoPrice(from, to);
  }

  private async fiatFiat(from: Fiat, to: Fiat): Promise<Price> {
    if (from.id === to.id) return Price.create(from.name, to.name, 1);

    return this.currencyService.getPrice(from.name, to.name);
  }

  private async fiatCustom(from: Fiat, to: Asset): Promise<Price> {
    if (to.blockchain === ('Talium' as Blockchain)) return this.currencyService.getPrice(from.name, this.eur.name);

    throw new Error(`No price available for custom asset ${to.uniqueName}`);
  }

  // --- HELPER METHODS --- //
  private isFiat(item: Asset | Fiat): item is Fiat {
    return item instanceof Fiat;
  }

  private isCustom(item: Asset): boolean {
    return item.type === AssetType.CUSTOM;
  }

  private async getFiatReferenceAssetFor(blockchain: Blockchain): Promise<Asset> {
    if (!this.refAssetMap.has(blockchain)) {
      const refAsset = await this.assetService.getAssetByQuery({
        dexName: 'USDT',
        type: AssetType.TOKEN,
        blockchain: blockchain,
      });
      this.refAssetMap.set(blockchain, refAsset);
    }

    return this.refAssetMap.get(blockchain);
  }
}
