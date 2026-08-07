import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

interface DenarioPriceResponse {
  priceAsk?: string | null;
  priceBid?: string | null;
  currency?: string;
  priceDate?: string;
}

@Injectable()
export class PricingDenarioService extends PricingProvider implements OnModuleInit {
  private readonly logger = new DfxLogger(PricingDenarioService);

  private static readonly DGC = 'DGC';
  private static readonly DSC = 'DSC';
  private static readonly ALLOWED_TOKENS = [PricingDenarioService.DGC, PricingDenarioService.DSC];
  private static readonly ALLOWED_CURRENCIES = ['USD', 'CHF', 'EUR'];

  // Metal quotes refresh continuously. Anything older than 15 minutes is treated as unavailable
  // (~3× the DGC/DSC price_rule validity of 300s). There is no shared repo constant for external
  // quote age; price_rule.isPriceObsolete uses 24h for cached rule timestamps, which is too loose
  // for a live partner feed that is expected to update every few minutes.
  private static readonly MAX_PRICE_AGE_SECONDS = 15 * 60;

  private static readonly TOKEN_PATH: Record<string, string> = {
    [PricingDenarioService.DGC]: 'goldcoin',
    [PricingDenarioService.DSC]: 'silvercoin',
  };

  private assetService: AssetService;

  constructor(
    private readonly http: HttpService,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  onModuleInit() {
    this.assetService = this.moduleRef.get(AssetService, { strict: false });
  }

  async getPrice(from: string, to: string, param?: string): Promise<Price> {
    const { token, currency } = this.resolvePair(from, to);

    const livePrice = await this.getLivePrice(token, currency, param);
    if (livePrice != null) return this.toPrice(from, to, token, livePrice);

    // Live feed unavailable or stale: fall back to the last persisted asset price so estimates
    // keep working during an outage. Flagged invalid so the rule update does not store it as fresh
    // and VALID_ONLY consumers still skip it.
    //
    // Buy is priced off priceAsk; sell is priced off priceBid when the rule is configured with
    // sellPriceSource 'Denario:bid' (param === 'bid'). Both values come from the same Denario
    // response. Without param (or any value other than 'bid') the ask is used — the previous
    // default for both directions.
    const fallback = await this.getLastKnownPrice(token, currency);
    if (fallback == null) throw new Error(`No price available for ${from} -> ${to}`);

    return this.toPrice(from, to, token, fallback.price, false, fallback.timestamp);
  }

  // --- HELPER METHODS --- //

  private resolvePair(from: string, to: string): { token: string; currency: string } {
    const fromIsToken = PricingDenarioService.ALLOWED_TOKENS.includes(from);
    const toIsToken = PricingDenarioService.ALLOWED_TOKENS.includes(to);
    const fromIsCurrency = PricingDenarioService.ALLOWED_CURRENCIES.includes(from);
    const toIsCurrency = PricingDenarioService.ALLOWED_CURRENCIES.includes(to);

    if (fromIsToken && toIsCurrency) return { token: from, currency: to };
    if (toIsToken && fromIsCurrency) return { token: to, currency: from };

    throw new Error(`from asset ${from} to asset ${to} is not allowed`);
  }

  private async getLivePrice(token: string, currency: string, param?: string): Promise<number | null> {
    const apiKey = Config.denario?.apiKey;
    const baseUrl = Config.denario?.baseUrl;
    if (!apiKey || !baseUrl) {
      this.logger.info('Denario price API not configured (missing DENARIO_PRICE_URL or DENARIO_PRICE_API_KEY)');
      return null;
    }

    const path = PricingDenarioService.TOKEN_PATH[token];
    if (!path) throw new Error(`No Denario path for token ${token}`);

    const url = `${baseUrl.replace(/\/$/, '')}/api/${path}/latest/${currency}`;

    let response: DenarioPriceResponse;
    try {
      response = await this.http.get<DenarioPriceResponse>(url, {
        headers: { 'X-AUTH-TOKEN': apiKey },
        tryCount: 3,
      });
    } catch (e) {
      // HTTP errors (incl. 401) fall back; parse/sanity failures below throw instead.
      this.logger.info(`Denario live price unavailable for ${token}/${currency}, falling back to last known price:`, e);
      return null;
    }

    if (response == null) {
      this.logger.info(`Denario response for ${token}/${currency} is empty`);
      return null;
    }

    // param === 'bid' → priceBid; otherwise priceAsk (including no param — today's default).
    const field: 'priceBid' | 'priceAsk' = param === 'bid' ? 'priceBid' : 'priceAsk';

    // Missing field → fallback. Present but invalid (null, "0", non-numeric, insane) → throw.
    if (response[field] === undefined) {
      this.logger.info(`Denario response for ${token}/${currency} missing ${field}`);
      return null;
    }

    const value = this.parsePrice(response[field], field, token, currency);

    if (!response.priceDate) {
      this.logger.info(`Denario response for ${token}/${currency} missing priceDate`);
      return null;
    }

    const priceDate = new Date(response.priceDate);
    if (Number.isNaN(priceDate.getTime())) {
      this.logger.info(`Denario response for ${token}/${currency} has unparseable priceDate '${response.priceDate}'`);
      return null;
    }

    const ageSeconds = Util.secondsDiff(priceDate);
    if (ageSeconds > PricingDenarioService.MAX_PRICE_AGE_SECONDS) {
      this.logger.info(
        `Denario price for ${token}/${currency} is stale (age ${Math.round(ageSeconds)}s > ${PricingDenarioService.MAX_PRICE_AGE_SECONDS}s)`,
      );
      return null;
    }

    return value;
  }

  private parsePrice(
    raw: string | null | undefined,
    field: 'priceAsk' | 'priceBid',
    token: string,
    currency: string,
  ): number {
    if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
      throw new Error(`Denario ${field} for ${token}/${currency} is missing or empty`);
    }

    const price = Number(raw);
    if (!Number.isFinite(price)) {
      throw new Error(`Denario ${field} for ${token}/${currency} is not a finite number: '${raw}'`);
    }
    if (!Asset.isSanePrice(price)) {
      throw new Error(`Denario ${field} for ${token}/${currency} is not a sane price: ${price}`);
    }

    return price;
  }

  private async getLastKnownPrice(token: string, currency: string): Promise<{ price: number; timestamp: Date } | null> {
    const asset = await this.assetService
      ?.getAssetByQuery({ name: token, blockchain: Blockchain.POLYGON, type: AssetType.TOKEN })
      .catch(() => null);

    if (!asset) return null;

    const price =
      currency === 'USD' ? asset.approxPriceUsd : currency === 'CHF' ? asset.approxPriceChf : asset.approxPriceEur;

    if (!Asset.isSanePrice(price)) return null;

    return { price: price as number, timestamp: asset.updated };
  }

  private toPrice(
    from: string,
    to: string,
    token: string,
    marketPrice: number,
    isValid = true,
    timestamp = new Date(),
  ): Price {
    // Price.create(from, to, price); Price.convert divides by price.
    // Token → currency: stored value is 1/market so convert(1) yields market.
    // Currency → token: stored value is market so convert(1) yields 1/market.
    // 12 decimals (not 8): gold quotes are ~10^3–10^4, so 1/price needs enough digits for
    // convert(1) to recover the market price within 0.0001 (8 decimals would leave ~0.1 USD error).
    const assetPrice = from === token ? 1 / marketPrice : marketPrice;

    return Price.create(from, to, Util.round(assetPrice, 12), isValid, timestamp);
  }
}
