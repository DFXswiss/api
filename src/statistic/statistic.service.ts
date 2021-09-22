import { Injectable } from '@nestjs/common';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { LogRepository } from 'src/log/log.repository';
import { CfpService } from 'src/services/cfp.service';

@Injectable()
export class StatisticService {
  constructor(
    private buyRepository: BuyRepository,
    private sellRepository: SellRepository,
    private logRepository: LogRepository,
    private cfpService: CfpService,
  ) {}

  async getBuyRoutes(): Promise<number> {
    return this.buyRepository.getBuyOrder();
  }

  async getSellRoutes(): Promise<number> {
    return this.sellRepository.getSellOrder();
  }

  async getRoutes(): Promise<any> {
    return {
      buy: await this.getBuyRoutes(),
      sell: await this.getSellRoutes(),
    };
  }

  async getDFIBuyVolume(): Promise<any> {
    return this.logRepository.getBuyDFIVolume();
  }

  async getDFISellVolume(): Promise<any> {
    return this.logRepository.getSellDFIVolume();
  }

  async getDFIVolume(): Promise<any> {
    return this.logRepository.getDFIVolume();
  }

  async getCHFVolume(): Promise<any> {
    return this.logRepository.getCHFVolume();
  }

  async getAll(): Promise<any> {
    return {
      dfxStatistic: {
        routes: await this.getRoutes(),
        volume: { DFI: await this.getDFIVolume(), CHF: await this.getCHFVolume() },
      },
    };
  }

  async getDfxCfpResults(): Promise<any> {
    return {
      dfx_cfps: await this.cfpService.getDfxResults(),
    };
  }

  async getAllCfpResults(): Promise<any> {
    return {
      all_cfp: await this.cfpService.getAllCfpResults(),
    };
  }

  async getCfpResult(number: number): Promise<any> {
    return {
      cfp: await this.cfpService.getCfpResult(number),
    };
  }
}
