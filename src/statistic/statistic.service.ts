import { Injectable } from '@nestjs/common';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { LogService } from 'src/log/log.service';
import { LogDirection, LogType } from 'src/log/log.entity';
import { ConversionService } from 'src/services/conversion.service';

@Injectable()
export class StatisticService {
  constructor(
    private buyRepository: BuyRepository,
    private sellRepository: SellRepository,
    private logService: LogService,
    private conversionService: ConversionService,
  ) {}

  async getBuyRouteCount(): Promise<number> {
    return this.buyRepository.count();
  }

  async getSellRouteCount(): Promise<number> {
    return this.sellRepository.count();
  }

  async getRouteCount(): Promise<any> {
    return {
      buy: await this.getBuyRouteCount(),
      sell: await this.getSellRouteCount(),
    };
  }

  async getAll(): Promise<any> {
    return {
      dfxStatistic: {
        routes: await this.getRouteCount(),
        volume: {
          DFI: {
            buy: await this.logService.getVolume(LogType.VOLUME, LogDirection.fiat2asset, 'assetValue'),
            sell: await this.logService.getVolume(LogType.VOLUME, LogDirection.asset2fiat, 'assetValue'),
          },
          EUR: {
            buy: this.conversionService.convertFiatCurrency(
              await this.logService.getVolume(LogType.VOLUME, LogDirection.fiat2asset, 'fiatInCHF'),
              'chf',
              'eur',
              new Date(),
            ),
            sell: this.conversionService.convertFiatCurrency(
              await this.logService.getVolume(LogType.VOLUME, LogDirection.asset2fiat, 'fiatInCHF'),
              'chf',
              'eur',
              new Date(),
            ),
          },
          CHF: {
            buy: await this.logService.getVolume(LogType.VOLUME, LogDirection.fiat2asset, 'fiatInCHF'),
            sell: await this.logService.getVolume(LogType.VOLUME, LogDirection.asset2fiat, 'fiatInCHF'),
          },
        },
      },
    };
  }
}
