import { Injectable } from '@nestjs/common';
import { BuyRepository } from 'src/buy/buy.repository';
import { SellRepository } from 'src/sell/sell.repository';
import { LogService } from 'src/log/log.service';
import { LogDirection, LogType } from 'src/log/log.entity';
import { ConversionService } from 'src/shared/services/conversion.service';

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
            buy: await this.logService.getAssetVolume(LogType.VOLUME, LogDirection.fiat2asset),
            sell: await this.logService.getAssetVolume(LogType.VOLUME, LogDirection.asset2fiat),
          },
          EUR: {
            buy: await this.conversionService.convertFiatCurrency(
              await this.logService.getChfVolume(LogType.VOLUME, LogDirection.fiat2asset),
              'chf',
              'eur',
            ),
            sell: await this.conversionService.convertFiatCurrency(
              await this.logService.getChfVolume(LogType.VOLUME, LogDirection.asset2fiat),
              'chf',
              'eur',
            ),
          },
          CHF: {
            buy: await this.logService.getChfVolume(LogType.VOLUME, LogDirection.fiat2asset),
            sell: await this.logService.getChfVolume(LogType.VOLUME, LogDirection.asset2fiat),
          },
        },
      },
    };
  }
}
