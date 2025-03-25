import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FrankencoinService } from 'src/integration/blockchain/frankencoin/frankencoin.service';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingFrankencoinService extends PricingProvider implements OnModuleInit {
  private static readonly ZCHF = 'ZCHF';
  private static readonly FPS = 'FPS';
  private static readonly ALLOWED_ASSETS = [PricingFrankencoinService.ZCHF, PricingFrankencoinService.FPS];

  private static readonly CONTRACT_FEE = 0.003;

  private frankencoinService: FrankencoinService;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  async onModuleInit() {
    this.frankencoinService = this.moduleRef.get(FrankencoinService, { strict: false });
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (!PricingFrankencoinService.ALLOWED_ASSETS.includes(from)) throw new Error(`from asset ${from} is not allowed`);
    if (!PricingFrankencoinService.ALLOWED_ASSETS.includes(to)) throw new Error(`to asset ${to} is not allowed`);

    // TODO: This calculation is only correct for purchases
    const contractPrice = (await this.frankencoinService.getFPSPrice()) * (1 + PricingFrankencoinService.CONTRACT_FEE);
    const assetPrice = from === PricingFrankencoinService.ZCHF ? contractPrice : 1 / contractPrice;

    return Price.create(from, to, Util.round(assetPrice, 8));
  }
}
