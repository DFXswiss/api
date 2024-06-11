import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FrankencoinService } from 'src/integration/blockchain/frankencoin/frankencoin.service';
import { Util } from 'src/shared/utils/util';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from '../../domain/interfaces';

@Injectable()
export class PricingFrankencoinService implements OnModuleInit, PricingProvider {
  private static readonly ZCHF = 'ZCHF';
  private static readonly FPS = 'FPS';
  private static readonly ALLOWED_ASSETS = [PricingFrankencoinService.ZCHF, PricingFrankencoinService.FPS];

  private frankencoinService: FrankencoinService;

  constructor(private moduleRef: ModuleRef) {}

  onModuleInit() {
    this.frankencoinService = this.moduleRef.get(FrankencoinService, { strict: false });
  }

  async getPrice(from: string, to: string): Promise<Price> {
    if (!PricingFrankencoinService.ALLOWED_ASSETS.includes(from)) throw new Error(`from asset ${from} is not allowed`);
    if (!PricingFrankencoinService.ALLOWED_ASSETS.includes(to)) throw new Error(`to asset ${to} is not allowed`);

    const fpsPrice = await this.frankencoinService.getFPSPrice();

    if (from === PricingFrankencoinService.ZCHF) {
      return Price.create(from, to, Util.round(fpsPrice, 8));
    }

    return Price.create(from, to, Util.round(1 / fpsPrice, 8));
  }
}
