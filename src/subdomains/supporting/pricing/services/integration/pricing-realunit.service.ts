import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Config, Environment } from 'src/config/config';
import { RealUnitBlockchainService } from 'src/integration/blockchain/realunit/realunit-blockchain.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingRealUnitService extends PricingProvider implements OnModuleInit {
  private readonly logger = new DfxLogger(PricingRealUnitService);

  private static readonly REALU = 'REALU';
  private static readonly ZCHF = 'ZCHF';
  private static readonly EUR = 'EUR';

  private static readonly ALLOWED_ASSETS = [
    PricingRealUnitService.REALU,
    PricingRealUnitService.ZCHF,
    PricingRealUnitService.EUR,
  ];

  // Lazily evaluated: reading Config during field initialization crashes module bootstrap,
  // because Config is still undefined at construction time due to a circular import.
  private get tokenBlockchain(): Blockchain {
    return [Environment.DEV, Environment.LOC].includes(Config.environment) ? Blockchain.SEPOLIA : Blockchain.ETHEREUM;
  }

  private realunitService: RealUnitBlockchainService;
  private assetService: AssetService;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  onModuleInit() {
    this.realunitService = this.moduleRef.get(RealUnitBlockchainService, { strict: false });
    this.assetService = this.moduleRef.get(AssetService, { strict: false });
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (!PricingRealUnitService.ALLOWED_ASSETS.includes(from)) throw new Error(`from asset ${from} is not allowed`);
    if (!PricingRealUnitService.ALLOWED_ASSETS.includes(to)) throw new Error(`to asset ${to} is not allowed`);
    if (![from, to].includes(PricingRealUnitService.REALU))
      throw new Error(`from asset ${from} to asset ${to} is not allowed`);

    const isEurPair = [from, to].includes(PricingRealUnitService.EUR);

    const livePrice = await this.getLivePrice(isEurPair);
    if (livePrice != null) return this.toPrice(from, to, livePrice);

    // The live price source (Aktionariat) is unavailable: fall back to the last
    // persisted RealUnit price so estimates (non-exact quotes) keep working during
    // an outage. The price is flagged invalid, so it is not stored as a fresh price
    // by the rule update and strict consumers (VALID_ONLY, e.g. the price snapshot
    // job) still skip it instead of recording the stale value as current.
    const fallback = await this.getLastKnownPrice(isEurPair);
    if (fallback == null) throw new Error(`No price available for ${from} -> ${to}`);

    return this.toPrice(from, to, fallback.price, false, fallback.timestamp);
  }

  // --- HELPER METHODS --- //
  private async getLivePrice(isEurPair: boolean): Promise<number | null> {
    try {
      const price = isEurPair
        ? await this.realunitService.getRealUnitPriceEur()
        : await this.realunitService.getRealUnitPriceChf();

      return price ?? null;
    } catch (e) {
      this.logger.info('RealUnit live price (Aktionariat) unavailable, falling back to last known price:', e);
      return null;
    }
  }

  private async getLastKnownPrice(isEurPair: boolean): Promise<{ price: number; timestamp: Date } | null> {
    const asset = await this.assetService
      .getAssetByQuery({ name: PricingRealUnitService.REALU, blockchain: this.tokenBlockchain, type: AssetType.TOKEN })
      .catch(() => null);

    const price = isEurPair ? asset?.approxPriceEur : asset?.approxPriceChf;
    if (!price) return null;

    return { price, timestamp: asset.updated };
  }

  private toPrice(from: string, to: string, realunitPrice: number, isValid = true, timestamp = new Date()): Price {
    const assetPrice = from === PricingRealUnitService.REALU ? 1 / realunitPrice : realunitPrice;

    return Price.create(from, to, Util.round(assetPrice, 8), isValid, timestamp);
  }
}
