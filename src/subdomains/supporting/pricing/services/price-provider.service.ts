import { Injectable, NotImplementedException } from '@nestjs/common';
import { CoinGeckoService } from './integration/coin-gecko.service';
import { PriceProviderDeFiChainService } from './integration/price-provider-defichain.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Price } from '../domain/entities/price';
import { Fiat } from '../domain/enums';
import { MetadataNotFoundException } from '../domain/exceptions/metadata-not-found.exception';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CurrencyService } from './integration/currency.service';

/**
 * Price provider service - use this service for indicative and fiat prices
 */
@Injectable()
export class PriceProviderService {
  private readonly chainsWithSwapPricing = [Blockchain.DEFICHAIN];
  private readonly refAssetMap = new Map<Blockchain, Asset>();

  constructor(
    private readonly assetService: AssetService,
    private readonly coinGeckoService: CoinGeckoService,
    private readonly currencyService: CurrencyService,
    private readonly deFiChainService: PriceProviderDeFiChainService,
  ) {}

  async getPrice(from: Asset | Fiat, to: Asset | Fiat): Promise<Price> {
    if (this.isFiat(from)) {
      return this.isFiat(to) ? this.fiatFiat(from, to) : this.fiatCrypto(from, to);
    } else {
      return this.isFiat(to) ? this.cryptoFiat(from, to) : this.cryptoCrypto(from, to);
    }
  }

  // --- CONVERSION METHODS --- //
  private async cryptoCrypto(from: Asset, to: Asset): Promise<Price> {
    // get swap price, if available
    if (from.blockchain === to.blockchain && this.chainsWithSwapPricing.includes(from.blockchain))
      return this.getSwapPrice(from, to);

    // get exchange price via USD
    const fromPrice = await this.cryptoFiat(from, Fiat.USD);
    const toPrice = await this.fiatCrypto(Fiat.USD, to);

    return Price.join(fromPrice, toPrice);
  }

  private async cryptoFiat(from: Asset, to: Fiat): Promise<Price> {
    try {
      return await this.coinGeckoService.toFiat(from, to);
    } catch (e) {
      if (!(e instanceof MetadataNotFoundException)) throw e;
    }

    // metadata not found -> use reference asset
    const refAsset = await this.getFiatReferenceAssetFor(from.blockchain);

    const toRef = await this.getSwapPrice(from, refAsset);
    const fromRef = await this.coinGeckoService.toFiat(refAsset, to);

    return Price.join(toRef, fromRef);
  }

  private async fiatCrypto(from: Fiat, to: Asset): Promise<Price> {
    try {
      return await this.coinGeckoService.fromFiat(from, to);
    } catch (e) {
      if (!(e instanceof MetadataNotFoundException)) throw e;
    }

    // metadata not found -> use reference asset
    const refAsset = await this.getFiatReferenceAssetFor(to.blockchain);

    const toRef = await this.coinGeckoService.fromFiat(from, refAsset);
    const fromRef = await this.getSwapPrice(refAsset, to);

    return Price.join(toRef, fromRef);
  }

  private async fiatFiat(from: Fiat, to: Fiat): Promise<Price> {
    return this.currencyService.getPrice(from, to);
  }

  // --- HELPER METHODS --- //
  private isFiat(item: Asset | Fiat): item is Fiat {
    return typeof item === 'string' && Object.values(Fiat).includes(item);
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

  async getSwapPrice(from: Asset, to: Asset): Promise<Price> {
    if (from.blockchain !== to.blockchain) throw new Error('Inter blockchain swap prices not possible');

    if (!this.chainsWithSwapPricing.includes(from.blockchain))
      throw new NotImplementedException(`Swap pricing is not implemented for ${from.blockchain}`);

    return this.deFiChainService.getPrice(from, to);
  }
}
