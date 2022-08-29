import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { BinanceService } from './binance.service';
import { BitpandaService } from './bitpanda.service';
import { BitstampService } from './bitstamp.service';
import { Price } from './dto/price.dto';
import { PriceMismatchException } from './exceptions/price-mismatch.exception';
import { KrakenService } from './kraken.service';

// NOTE - Ideally from Asset to Asset where Fiat is also Asset.
interface PriceRequest {
  // TODO - if assets are same just return same amount, same applies to stable coins, USDC, USDT, maybe EUR....???
  from: string;
  to: string;
  options?: PriceRequestOptions;
}

interface PriceRequestOptions {
  includeReversePrice?: boolean;
  // NOTE - potential extension
  cached?: boolean;
  fromBlockchain?: Blockchain;
  toBlockchain?: Blockchain;
  fromVolume?: number;
}

interface PriceResult {
  path: PricePath;
  price: Price;
  reversePath?: PricePath;
  reversePrice?: Price;
}

interface PricePath {
  [key: number]: PriceStep;
}

interface PriceStep {
  price: Price;
  vendor: PriceVendor;
  timestamp: Date;
}

// maybe upgrade to class with .execute() method
interface PricePathExecutable {
  [key: number]: PriceStepExecutable;
}

// this also have to be executable.
interface PriceStepExecutable {
  from: string;
  to: string;
  vendor: PriceVendor;
}

type PriceVendor = string;

@Injectable()
export class ExchangeUtilityService {
  constructor(
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly bitstampService: BitstampService,
    private readonly bitpandaService: BitpandaService,
  ) {}

  async getPrice(request: PriceRequest): Promise<PriceResult> {
    const path = this.getPath(request);

    // TODO - maybe separate classes, place behind interface
    return this.executePath(path, request.options);
  }

  async getMatchingPrice(fromCurrency: string, toCurrency: string, matchThreshold = 0.02): Promise<Price> {
    const mainPrice = await this.krakenService.getPrice(fromCurrency, toCurrency);

    try {
      const [refPrice, refSource] = await this.getReferencePrice(fromCurrency, toCurrency);

      const { price: _mainPrice } = mainPrice;
      const { price: _refPrice } = refPrice;

      if (Math.abs(_refPrice - _mainPrice) / _mainPrice > matchThreshold)
        throw new PriceMismatchException(
          `${fromCurrency} to ${toCurrency} price mismatch (kraken: ${_mainPrice}, ${refSource}: ${_refPrice})`,
        );
    } catch (e) {
      if (e instanceof PriceMismatchException) throw e;

      console.warn(
        `Proceeding without reference check from Binance, Bitstamp and Bitpanda. From ${fromCurrency} to ${toCurrency}`,
      );
    }

    return mainPrice;
  }

  private async getReferencePrice(fromCurrency: string, toCurrency: string): Promise<[Price, PriceVendor]> {
    const referenceExchanges = [this.binanceService, this.bitstampService, this.bitpandaService];

    for (const exchange of referenceExchanges) {
      try {
        return [await exchange.getPrice(fromCurrency, toCurrency), exchange.name];
      } catch {}
    }

    throw new Error(
      `Could not find reference price at Binance, Bitstamp and Bitpanda. From ${fromCurrency} to ${toCurrency}`,
    );
  }

  //*** HELPER METHODS ***//

  private getPath(request: PriceRequest): PricePathExecutable {
    return {};
  }

  private executePath(path: PricePathExecutable, options: PriceRequestOptions): PriceResult {
    return null;
  }
}
